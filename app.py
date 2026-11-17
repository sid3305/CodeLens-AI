
import streamlit as st
from pathlib import Path
import html
import json
from datetime import datetime

from utils.file_handler import (
    save_uploaded_file,
    extract_zip,
    get_code_files,
    clone_github_repo
)

from utils.parser import read_file_content

from agents.repo_agent import run_repo_agent
from agents.explain_agent import run_explain_agent
from utils.analysis_engine import run_all_analyzers


# -----------------------------------
# Page Configuration
# -----------------------------------

st.set_page_config(
    page_title="CodeLens AI",
    page_icon="🤖",
    layout="wide"
)

st.title("🤖 CodeLens AI")

st.markdown(
    "AI-powered repository analysis and code explanation."
)


# -----------------------------------
# Session State
# -----------------------------------

DEFAULT_STATE = {
    "activity_logs": [],
    "all_code_files": [],
    "repository_summary": None,
    "file_explanation": None,
    "selected_file": None,
    "processed_upload_id": None,
    "repository_name": None,
    "analysis_results": [],
    "analysis_tool_status": {},
    "analysis_completed": False,
    "selected_source_finding": None
}

for key, default_value in DEFAULT_STATE.items():
    if key not in st.session_state:
        st.session_state[key] = default_value


def build_report_data(repository_name, findings, tool_status):
    """Build structured data for JSON and HTML reports."""

    severity_counts = {
        "Critical": 0,
        "High": 0,
        "Medium": 0,
        "Low": 0,
        "Info": 0
    }

    for finding in findings:
        severity = str(
            finding.get("severity", "Info")
        ).title()

        if severity in severity_counts:
            severity_counts[severity] += 1

    return {
        "report_title": "CodeLens AI - Security Analysis Report",
        "repository": repository_name or "Unknown Repository",
        "generated_at": datetime.now().astimezone().isoformat(),
        "summary": {
            "total_findings": len(findings),
            "severity_breakdown": severity_counts
        },
        "analyzer_status": tool_status,
        "findings": findings
    }


def generate_html_report(report_data):
    """Generate a downloadable HTML analysis report."""

    summary = report_data["summary"]
    severity_counts = summary["severity_breakdown"]

    severity_cards = ""

    for severity, count in severity_counts.items():
        severity_cards += f"""
            <div class="metric">
                <span>{html.escape(severity)}</span>
                <strong>{count}</strong>
            </div>
        """

    analyzer_rows = ""

    for tool, details in report_data["analyzer_status"].items():
        status = html.escape(str(details.get("status", "Unknown")))
        count = details.get("findings", 0)
        error = html.escape(str(details.get("error") or ""))

        analyzer_rows += f"""
            <tr>
                <td>{html.escape(str(tool))}</td>
                <td>{status}</td>
                <td>{count}</td>
                <td>{error}</td>
            </tr>
        """

    finding_rows = ""

    for index, finding in enumerate(report_data["findings"], start=1):

        detected_by = ", ".join(
            finding.get("detected_by", [])
        )

        finding_rows += f"""
            <tr>
                <td>{index}</td>
                <td>{html.escape(str(finding.get("title", "")))}</td>
                <td>{html.escape(str(finding.get("severity", "")))}</td>
                <td>{html.escape(str(finding.get("confidence", "Not assessed")))}</td>
                <td>{html.escape(str(detected_by))}</td>
                <td>{html.escape(str(finding.get("file", "")))}</td>
                <td>{html.escape(str(finding.get("line", "")))}</td>
                <td>{html.escape(str(finding.get("description", "")))}</td>
                <td>{html.escape(str(finding.get("recommendation", "")))}</td>
            </tr>
        """

    if not finding_rows:
        finding_rows = """
            <tr>
                <td colspan="9">No findings were reported.</td>
            </tr>
        """

    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <title>CodeLens AI Analysis Report</title>

        <style>
            body {{
                font-family: Arial, sans-serif;
                background: #f4f6fa;
                color: #1f2937;
                margin: 0;
                padding: 30px;
            }}

            .container {{
                max-width: 1400px;
                margin: auto;
                background: white;
                padding: 30px;
                border-radius: 12px;
            }}

            h1, h2 {{
                color: #172554;
            }}

            .subtitle {{
                color: #64748b;
                margin-bottom: 25px;
            }}

            .metrics {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                gap: 15px;
                margin: 20px 0 35px;
            }}

            .metric {{
                background: #eef2ff;
                padding: 18px;
                border-radius: 8px;
            }}

            .metric span {{
                display: block;
                color: #475569;
            }}

            .metric strong {{
                display: block;
                font-size: 28px;
                margin-top: 8px;
            }}

            table {{
                width: 100%;
                border-collapse: collapse;
                margin: 15px 0 35px;
                font-size: 13px;
            }}

            th, td {{
                border: 1px solid #e2e8f0;
                padding: 10px;
                text-align: left;
                vertical-align: top;
                overflow-wrap: anywhere;
            }}

            th {{
                background: #172554;
                color: white;
            }}

            tr:nth-child(even) {{
                background: #f8fafc;
            }}

            .footer {{
                margin-top: 35px;
                color: #64748b;
                font-size: 12px;
            }}

            @media print {{
                body {{
                    background: white;
                    padding: 0;
                }}

                .container {{
                    padding: 0;
                }}
            }}
        </style>
    </head>

    <body>
        <div class="container">

            <h1>CodeLens AI</h1>
            <h2>Security & Code Analysis Report</h2>

            <div class="subtitle">
                <strong>Repository:</strong>
                {html.escape(str(report_data["repository"]))}
                <br>
                <strong>Generated:</strong>
                {html.escape(str(report_data["generated_at"]))}
            </div>

            <h2>Analysis Overview</h2>

            <div class="metrics">
                <div class="metric">
                    <span>Total Findings</span>
                    <strong>{summary["total_findings"]}</strong>
                </div>

                {severity_cards}
            </div>

            <h2>Analyzer Execution Status</h2>

            <table>
                <thead>
                    <tr>
                        <th>Analyzer</th>
                        <th>Status</th>
                        <th>Findings</th>
                        <th>Error</th>
                    </tr>
                </thead>
                <tbody>
                    {analyzer_rows}
                </tbody>
            </table>

            <h2>Detailed Findings</h2>

            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Title</th>
                        <th>Severity</th>
                        <th>Confidence</th>
                        <th>Detected By</th>
                        <th>File</th>
                        <th>Line</th>
                        <th>Description</th>
                        <th>Recommended Action</th>
                    </tr>
                </thead>
                <tbody>
                    {finding_rows}
                </tbody>
            </table>

            <div class="footer">
                Generated by CodeLens AI.
                Findings are automated analysis results and should be
                manually reviewed before remediation decisions.
            </div>

        </div>
    </body>
    </html>
    """

def log_activity(message):
    st.session_state.activity_logs.append(message)


def reset_repository(files, name):
    """Update the active repository and clear old AI results."""

    st.session_state.all_code_files = files
    st.session_state.repository_name = name
    st.session_state.repository_summary = None
    st.session_state.file_explanation = None
    st.session_state.selected_file = None

    st.session_state.analysis_results = []
    st.session_state.analysis_tool_status = {}
    st.session_state.analysis_completed = False
    st.session_state.selected_source_finding = None

# -----------------------------------
# Activity Logs
# -----------------------------------

st.sidebar.title("⚙ Activity Logs")

if st.session_state.activity_logs:
    for log in st.session_state.activity_logs:
        st.sidebar.write(log)
else:
    st.sidebar.caption("No activity yet.")


# -----------------------------------
# Repository Import Options
# -----------------------------------

st.header("📂 Import Your Project")

st.markdown("Choose how you want to provide your codebase.")


# -----------------------------------
# Option 1: GitHub Repository
# -----------------------------------

st.subheader("🐙 Import from GitHub")

with st.form("github_import_form"):

    github_url = st.text_input(
        "GitHub Repository URL",
        placeholder="https://github.com/username/repository"
    )

    github_submit = st.form_submit_button(
        "Import GitHub Repository"
    )


if github_submit:

    if not github_url.strip():

        st.warning("Please enter a GitHub repository URL.")

    else:

        try:

            with st.spinner("Cloning GitHub repository..."):

                log_activity("[System] GitHub import requested.")

                repo_folder = clone_github_repo(github_url)

                log_activity("[Repository Agent] GitHub repository cloned.")

                log_activity("[Repository Agent] Scanning repository...")

                code_files = get_code_files(repo_folder)

                if not code_files:
                    st.warning("No supported code files were found.")
                    reset_repository([], Path(repo_folder).name)

                else:
                    reset_repository(
                        code_files,
                        github_url.rstrip("/").split("/")[-1].removesuffix(".git")
                    )

                    log_activity(
                        f"[Repository Agent] Detected {len(code_files)} code files."
                    )

                    st.success("GitHub repository imported successfully!")

        except Exception as e:

            st.error(f"GitHub import failed: {e}")

            log_activity(f"[Error] GitHub import failed: {e}")


st.divider()


# -----------------------------------
# Option 2: File or ZIP Upload
# -----------------------------------

st.subheader("📤 Upload a File or ZIP")

uploaded_file = st.file_uploader(
    "Upload an individual code file or ZIP repository",
    type=[
        "py", "js", "java", "cpp", "c",
        "cs", "go", "rb", "php",
        "jsx", "ts", "tsx", "html", "css",
        "json", "yaml", "yml", "toml",
        "md", "sh", "bat", "sql",
        "zip"
    ]
)


if uploaded_file:

    upload_id = (
        uploaded_file.name,
        uploaded_file.size
    )

    if st.session_state.processed_upload_id != upload_id:

        try:

            log_activity("[System] Upload received.")

            saved_path = save_uploaded_file(uploaded_file)

            log_activity(
                f"[System] Saved file: {uploaded_file.name}"
            )

            file_extension = Path(saved_path).suffix.lower()

            if file_extension == ".zip":

                log_activity(
                    "[Repository Agent] Extracting ZIP repository..."
                )

                extracted_folder = extract_zip(saved_path)

                log_activity(
                    "[Repository Agent] Scanning repository..."
                )

                code_files = get_code_files(extracted_folder)

            else:

                code_files = [saved_path]

            reset_repository(
                code_files,
                Path(uploaded_file.name).stem
            )

            st.session_state.processed_upload_id = upload_id

            log_activity(
                f"[Repository Agent] Detected {len(code_files)} code files."
            )

        except Exception as e:

            st.error(f"File processing failed: {e}")

            log_activity(f"[Error] File processing failed: {e}")


# -----------------------------------
# Repository Preview
# -----------------------------------

all_code_files = st.session_state.all_code_files

if all_code_files:

    st.divider()

    st.header("📁 Repository Files")

    st.caption(
        f"Active project: {st.session_state.repository_name}"
    )

    st.success(
        f"Detected {len(all_code_files)} code files."
    )

    for file in all_code_files:
        st.write(Path(file).name)


    # -----------------------------------
    # Repository Summary
    # -----------------------------------

    st.divider()

    st.header("🧠 Repository Summary")

    if st.button(
        "Generate Repository Summary",
        key="repo_summary_button"
    ):

        repository_content = ""

        for file in all_code_files:

            try:

                content = read_file_content(file)

                if content.startswith("Error reading file:"):
                    continue

                repository_content += (
                    f"\n\nFILE: {Path(file).name}\n"
                    f"{content}\n"
                )

            except Exception:
                continue

        try:

            with st.spinner("Analyzing repository with Groq..."):

                summary = run_repo_agent(repository_content)

                st.session_state.repository_summary = summary

                log_activity(
                    "[Repository Agent] Summary generated."
                )

        except Exception as e:

            st.error(f"Repository analysis failed: {e}")


    if st.session_state.repository_summary:

        st.markdown("### Repository Analysis")

        st.markdown(
            st.session_state.repository_summary
        )

    
    # -----------------------------------
    # Static Code Analysis
    # -----------------------------------

    st.divider()

    st.header("🔍 Code Quality & Security Analysis")

    st.markdown(
        "Scan your project using Ruff, Bandit, Semgrep and Gitleaks."
    )

    if st.button(
        "🚀 Run Code Analysis",
        key="run_code_analysis"
    ):

        try:
            with st.spinner(
                "Running static analysis tools on your project..."
            ):

                results = run_all_analyzers(all_code_files[0] if len(all_code_files) == 1 else Path(all_code_files[0]).parent)

                st.session_state.analysis_results = results["findings"]
                st.session_state.analysis_tool_status = results["tool_status"]
                st.session_state.analysis_completed = True

                log_activity(
                    f"[Analysis Engine] Analysis completed. "
                    f"{results['total_findings']} findings detected."
                )

        except Exception as e:

            st.error(f"Code analysis failed: {e}")

            log_activity(f"[Error] Code analysis failed: {e}")


    # -----------------------------------
    # Analysis Dashboard
    # -----------------------------------

    if st.session_state.analysis_completed:

        findings = st.session_state.analysis_results
        tool_status = st.session_state.analysis_tool_status

        st.subheader("📊 Analysis Overview")

        critical_count = sum(
            1 for f in findings if f["severity"].lower() == "critical"
        )

        high_count = sum(
            1 for f in findings if f["severity"].lower() == "high"
        )

        medium_count = sum(
            1 for f in findings if f["severity"].lower() == "medium"
        )

        low_count = sum(
            1 for f in findings if f["severity"].lower() == "low"
        )

        col1, col2, col3, col4, col5 = st.columns(5)

        col1.metric("Total Findings", len(findings))
        col2.metric("🔴 Critical", critical_count)
        col3.metric("🟠 High", high_count)
        col4.metric("🟡 Medium", medium_count)
        col5.metric("🟢 Low", low_count)

        st.divider()

        # Tool execution status

        st.subheader("🛠 Analyzer Status")

        status_cols = st.columns(4)

        for index, (tool, details) in enumerate(tool_status.items()):

            with status_cols[index % 4]:

                if details["status"] == "Completed":

                    st.success(
                        f"**{tool}**\n\n"
                        f"Completed\n\n"
                        f"Findings: {details['findings']}"
                    )

                else:

                    st.error(
                        f"**{tool}**\n\n"
                        f"Failed\n\n"
                        f"{details['error']}"
                    )

        st.divider()
        
        # -----------------------------------
        # Report Export
        # -----------------------------------

        st.divider()

        st.subheader("📥 Download Analysis Reports")

        report_data = build_report_data(
            st.session_state.repository_name,
            findings,
            tool_status
        )

        report_json = json.dumps(
            report_data,
            indent=4,
            ensure_ascii=False,
            default=str
        )

        report_html = generate_html_report(report_data)

        repository_filename = (
            str(st.session_state.repository_name or "repository")
            .replace(" ", "_")
        )

        export_col1, export_col2 = st.columns(2)

        with export_col1:
            st.download_button(
                label="📄 Download JSON Report",
                data=report_json,
                file_name=f"{repository_filename}_analysis_report.json",
                mime="application/json",
                key="download_json_report"
            )

        with export_col2:
            st.download_button(
                label="🌐 Download HTML Report",
                data=report_html,
                file_name=f"{repository_filename}_analysis_report.html",
                mime="text/html",
                key="download_html_report"
            )

        st.caption(
            "Reports contain the complete normalized and deduplicated "
            "findings from the latest analysis."
        )

        # Findings filters

        st.subheader("📋 Detected Issues")

        if findings:

            filter_col1, filter_col2, filter_col3 = st.columns(3)

            with filter_col1:

                severity_options = ["All"] + sorted(
                    set(f["severity"] for f in findings)
                )

                selected_severity = st.selectbox(
                    "Filter by Severity",
                    severity_options
                )

            with filter_col2:

                tool_options = ["All"] + sorted({
                    tool
                    for finding in findings
                    for tool in finding["detected_by"]
                })

                selected_tool = st.selectbox(
                    "Filter by Analyzer",
                    tool_options
                )

            with filter_col3:

                category_options = ["All"] + sorted(
                    set(f["category"] for f in findings)
                )

                selected_category = st.selectbox(
                    "Filter by Category",
                    category_options
                )

            filtered_findings = findings

            if selected_severity != "All":

                filtered_findings = [
                    f for f in filtered_findings
                    if f["severity"] == selected_severity
                ]

            if selected_tool != "All":
                filtered_findings = [
                    f for f in filtered_findings
                    if selected_tool in f["detected_by"]
                ]

            if selected_category != "All":

                filtered_findings = [
                    f for f in filtered_findings
                    if f["category"] == selected_category
                ]

            st.caption(
                f"Showing {len(filtered_findings)} of {len(findings)} findings."
            )

            for index, finding in enumerate(filtered_findings):

                severity = finding["severity"].upper()

                if severity == "HIGH":
                    severity_icon = "🔴"
                elif severity == "MEDIUM":
                    severity_icon = "🟠"
                else:
                    severity_icon = "🟢"

                file_name = Path(finding["file"]).name

                title = (
                    f"{severity_icon} {finding['title']} "
                    f"— {file_name}:{finding['line'] or '-'}"
                )

                with st.expander(title):

                    col1, col2 = st.columns(2)

                    col1.write(f"**Detected by:** {', '.join(finding['detected_by'])}")
                    col1.write(f"**Rule:** {finding['rule_id']}")
                    col1.write(f"**Severity:** {severity}")

                    col2.write(f"**Category:** {finding['category']}")
                    col2.write(f"**File:** {finding['file']}")
                    col2.write(f"**Line:** {finding['line']}")
                    col1.write(f"**Confidence:** {finding['confidence']}")
                    col1.write(f"**Duplicate reports consolidated:** {finding['duplicate_count']}")

                    st.markdown("**Description**")
                    st.write(finding["description"])

                    st.markdown("**Recommended Action**")
                    st.write(finding["recommendation"])
                    if st.button(
                        "📍 View Source",
                        key=f"view_source_{index}_{finding.get('id', 'finding')}"
                    ):
                        st.session_state.selected_source_finding = {
                            "file": finding["file"],
                            "line": finding["line"],
                            "title": finding["title"]
                        }
                        st.rerun()
        else:

            st.success(
                "No findings were reported by the completed analyzers."
            )
    
    # -----------------------------------
    # Source Code Navigation
    # -----------------------------------

    selected_finding = st.session_state.selected_source_finding

    if selected_finding:

        st.divider()
        st.header("📍 Source Code Location")

        finding_file = selected_finding["file"]
        finding_line = selected_finding["line"]

        # Match the finding's file with the imported repository files
        matched_file = None

        try:
            target_path = Path(finding_file).resolve()

            for file_path in all_code_files:
                if Path(file_path).resolve() == target_path:
                    matched_file = file_path
                    break

        except Exception:
            pass

        # Fallback: match by filename only when it is unique
        if matched_file is None:
            matching_files = [
                file_path for file_path in all_code_files
                if Path(file_path).name.lower()
                == Path(finding_file).name.lower()
            ]

            if len(matching_files) == 1:
                matched_file = matching_files[0]

        if matched_file is None:

            st.error(
                "Could not locate the source file for this finding."
            )

        else:

            st.markdown(f"**Issue:** {selected_finding['title']}")
            st.markdown(f"**File:** `{finding_file}`")
            st.markdown(f"**Reported line:** {finding_line}")

            try:

                source = Path(matched_file).read_text(
                    encoding="utf-8",
                    errors="replace"
                )

                source_lines = source.splitlines()

                try:
                    line_number = int(finding_line)
                except (TypeError, ValueError):
                    line_number = None

                if not source_lines:
                    st.warning("This source file is empty.")

                elif line_number is None or not (
                    1 <= line_number <= len(source_lines)
                ):
                    st.warning(
                        "The reported line number is unavailable. "
                        "Showing the complete source file."
                    )
                    st.code(source, language="python", line_numbers=True)

                else:

                    # Display five lines before and after the finding
                    start_line = max(1, line_number - 5)
                    end_line = min(len(source_lines), line_number + 5)

                    st.caption(
                        f"Showing lines {start_line}–{end_line}"
                    )

                    highlighted_lines = []

                    for current_line in range(start_line, end_line + 1):

                        line_content = html.escape(
                            source_lines[current_line - 1]
                        )

                        if not line_content:
                            line_content = "&nbsp;"

                        if current_line == line_number:

                            highlighted_lines.append(
                                f"""
                                <div style="
                                    display: flex;
                                    background-color: #7f1d1d;
                                    color: white;
                                    padding: 3px 8px;
                                    border-radius: 4px;
                                ">
                                    <span style="
                                        min-width: 45px;
                                        color: #fecaca;
                                        user-select: none;
                                    ">{current_line}</span>
                                    <code style="
                                        color: white;
                                        white-space: pre;
                                    ">{line_content}</code>
                                </div>
                                """
                            )

                        else:

                            highlighted_lines.append(
                                f"""
                                <div style="
                                    display: flex;
                                    padding: 3px 8px;
                                ">
                                    <span style="
                                        min-width: 45px;
                                        color: #9ca3af;
                                        user-select: none;
                                    ">{current_line}</span>
                                    <code style="
                                        color: inherit;
                                        white-space: pre;
                                    ">{line_content}</code>
                                </div>
                                """
                            )

                    code_html = "\n".join(highlighted_lines)

                    st.html(
                        f"""
                        <div style="
                            background-color: #111827;
                            padding: 12px;
                            border-radius: 8px;
                            overflow-x: auto;
                            font-family: monospace;
                            font-size: 13px;
                            line-height: 1.6;
                        ">
                            {code_html}
                        </div>
                        """
                    )

            except Exception as e:

                st.error(f"Unable to display source code: {e}")

            if st.button(
                "✖ Close Source Viewer",
                key="close_source_viewer"
            ):
                st.session_state.selected_source_finding = None
                st.rerun()

    # -----------------------------------
    # Individual File Selection
    # -----------------------------------

    st.divider()

    st.header("📄 File Content Preview")

    selected_file = st.selectbox(
        "Select a file",
        all_code_files,
        format_func=lambda x: str(Path(x).relative_to(
            Path(st.session_state.all_code_files[0]).parents[
                len(Path(st.session_state.all_code_files[0]).parents) - 1
            ]
        )) if False else Path(x).name
    )

    st.session_state.selected_file = selected_file

    content = read_file_content(selected_file)

    file_name = Path(selected_file).name

    with st.expander(f"View {file_name}", expanded=True):

        st.code(
            content,
            line_numbers=True
        )


    # -----------------------------------
    # Explain Selected File
    # -----------------------------------

    st.divider()

    st.header("💡 AI Code Explanation")

    if st.button(
        "Explain Selected File",
        key="explain_file_button"
    ):

        if not content or content.startswith("Error reading file:"):

            st.error("Unable to read the selected file.")

        else:

            try:

                with st.spinner(
                    f"Explaining {file_name} using Groq..."
                ):

                    explanation = run_explain_agent(
                        content,
                        file_path=selected_file
                    )

                    st.session_state.file_explanation = explanation

                    log_activity(
                        f"[Explanation Agent] Explained {file_name}"
                    )

            except Exception as e:

                st.error(f"Code explanation failed: {e}")


    if st.session_state.file_explanation:

        st.markdown("### Explanation")

        st.markdown(
            st.session_state.file_explanation
        )


else:

    st.info(
        "Import a GitHub repository, upload a source file, "
        "or upload a ZIP repository to begin."
    )

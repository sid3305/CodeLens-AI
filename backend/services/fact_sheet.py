"""
A compact fact sheet about a repository, built only from data CodeLens
already computes (no LLM). It is the input of the AI summary, in priority
order with a cap per section, and the source of the static summary.
Paths are repository-relative; sensitive files are never read.
"""

from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

from backend.services.analysis_service import get_analysis_results
from backend.services.dependency_service import get_dependency_report
from backend.services.repository_service import list_repository_files
from utils.code_graph.models import NodeType
from utils.code_graph.parser_factory import parse_repository
from utils.parser import read_file_content
from utils.security import is_sensitive_file, resolve_within

LANGUAGES = {
    ".py": "Python", ".pyi": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
    ".cjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".java": "Java", ".go": "Go",
    ".rb": "Ruby", ".rs": "Rust", ".c": "C", ".cpp": "C++", ".cs": "C#", ".php": "PHP",
}
ENTRY_NAMES = {"main", "__main__", "index", "app", "server", "manage", "cli", "wsgi", "asgi"}
MANIFESTS = {"package.json", "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "pipfile", "tsconfig.json"}
SEVERITY_RANK = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}

# Characters per section, in priority order (sections are dropped from the
# bottom when the whole sheet does not fit the token budget).
CAPS = {"overview": 700, "dependencies": 800, "structure": 700, "findings": 700, "readme": 1200, "signatures": 1500}
README_CHARS = 1200
SIGNATURE_FILES = 5


def _cap(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rsplit("\n", 1)[0] + "\n…"


def collect_facts(repo_id: str, repository: dict) -> dict[str, Any]:
    files = [item["path"] for item in list_repository_files(repo_id)["files"]]
    report = get_dependency_report(repo_id)
    analysis = get_analysis_results(repo_id) or {}

    languages = Counter(LANGUAGES[PurePosixPath(p).suffix.lower()] for p in files if PurePosixPath(p).suffix.lower() in LANGUAGES)
    entry_points = sorted(
        p for p in files
        if PurePosixPath(p).stem.lower() in ENTRY_NAMES or PurePosixPath(p).name.lower() in MANIFESTS
    )[:12]

    importers: Counter = Counter()
    for edge in report.get("module_dependencies", []):
        if edge.get("import_type") == "internal" and edge["source_module"] != edge["target_module"]:
            importers[edge["target_module"]] += 1

    findings = sorted(
        analysis.get("findings", []),
        key=lambda f: (SEVERITY_RANK.get(f.get("severity"), 9), f.get("file") or "", f.get("line") or 0),
    )

    stats = report.get("stats", {})
    return {
        "name": repository["name"],
        "total_files": len(files),
        "languages": languages.most_common(),
        "entry_points": entry_points,
        "declared": [
            f"{d['name']}{' ' + d['version'] if d.get('version') else ''}"
            for d in report.get("external_dependencies", []) if d.get("declared")
        ][:15],
        "external_count": len(report.get("external_dependencies", [])),
        "import_counts": {key: stats.get(f"{key}_imports", 0) for key in ("internal", "stdlib", "external")},
        "hotspots": importers.most_common(8),
        "cycles": [c.get("cycle", []) for c in report.get("circular_dependencies", [])][:5],
        "findings_total": len(findings),
        "severity_counts": dict(Counter(f.get("severity") for f in findings)),
        "top_findings": [
            {"severity": f.get("severity"), "rule": f.get("rule_id") or "-", "file": f.get("file"), "line": f.get("line"), "title": f.get("title")}
            for f in findings[:5]
        ],
        "analysed": bool(analysis),
        "readme": _readme(repository, files),
        "signature_files": [path for path, _ in importers.most_common(SIGNATURE_FILES)],
    }


def _readme(repository: dict, files: list[str]) -> str:
    name = next((p for p in files if "/" not in p and PurePosixPath(p).stem.lower() == "readme"), None)
    if name is None:
        root = Path(repository["path"])
        name = next((p.name for p in sorted(root.glob("*")) if p.is_file() and p.stem.lower() == "readme"), None)
    if name is None or is_sensitive_file(name):
        return ""
    try:
        content = read_file_content(str(resolve_within(repository["path"], name)))
    except ValueError:
        return ""
    return "" if content.startswith("Error reading file:") else content[:README_CHARS]


def _signatures(repository: dict, paths: list[str]) -> str:
    """Class and function names with parameters (no bodies) of the most-imported files."""

    def read(relative: str) -> str:
        if is_sensitive_file(relative):
            return ""
        try:
            content = read_file_content(str(resolve_within(repository["path"], relative)))
        except ValueError:
            return ""
        return "" if content.startswith("Error reading file:") else content

    nodes = parse_repository([PurePosixPath(p) for p in paths], read)["nodes"]
    lines = []
    for path in paths:
        names = [
            f"{'class' if n.node_type == NodeType.CLASS else 'def'} {n.name}({', '.join(n.parameters)})"
            for n in nodes
            if n.file_path == path and n.node_type in (NodeType.CLASS, NodeType.FUNCTION, NodeType.METHOD)
        ]
        if names:
            lines.append(f"{path}: " + "; ".join(names[:12]))
    return "\n".join(lines)


def fact_sections(facts: dict[str, Any], repository: dict) -> list[str]:
    """The fact sheet as text sections, highest priority first."""

    languages = ", ".join(f"{name} ({count} files)" for name, count in facts["languages"]) or "unknown"
    overview = (
        f"Repository: {facts['name']}\nFiles: {facts['total_files']}\nLanguages: {languages}\n"
        f"Entry points and manifests: {', '.join(facts['entry_points']) or 'none found'}"
    )
    counts = facts["import_counts"]
    dependencies = (
        f"Declared dependencies: {', '.join(facts['declared']) or 'none declared'}\n"
        f"External packages imported: {facts['external_count']}\n"
        f"Import statements: {counts['internal']} internal, {counts['stdlib']} standard library, {counts['external']} external"
    )
    hotspots = ", ".join(f"{path} ({n} importers)" for path, n in facts["hotspots"]) or "none"
    cycles = "; ".join(" -> ".join(cycle) for cycle in facts["cycles"]) or "none"
    structure = f"Most imported files: {hotspots}\nImport cycles: {cycles}"
    if facts["analysed"]:
        findings = f"Findings: {facts['findings_total']} " + str(facts["severity_counts"]) + "\n" + "\n".join(
            f"- {f['severity']} {f['rule']} {f['file']}:{f['line']} {f['title']}" for f in facts["top_findings"]
        )
    else:
        findings = "Findings: static analysis not run yet."
    sections = [
        _cap(overview, CAPS["overview"]),
        _cap(dependencies, CAPS["dependencies"]),
        _cap(structure, CAPS["structure"]),
        _cap(findings, CAPS["findings"]),
    ]
    if facts["readme"]:
        sections.append(_cap(f"README (start):\n{facts['readme']}", CAPS["readme"]))
    signatures = _signatures(repository, facts["signature_files"])
    if signatures:
        sections.append(_cap(f"Signatures of the most imported files:\n{signatures}", CAPS["signatures"]))
    return sections


def _readme_line(readme: str) -> str:
    """The first sentence-like line of the README that is not a heading or badge."""

    for line in readme.splitlines():
        text = line.strip()
        if text and not text.startswith(("#", "!", "[", "<", "=", "-", "`")):
            return text[:200]
    return ""


def static_summary(facts: dict[str, Any]) -> str:
    """A summary written from the facts with fixed sentences: no LLM, no tokens."""

    languages = facts["languages"]
    main_language = languages[0][0] if languages else "multi-language"
    others = ", ".join(f"{name} ({count})" for name, count in languages) or "no recognised languages"
    counts = facts["import_counts"]
    bullets = [
        f"**What it is:** {facts['name']}, a {main_language} project with {facts['total_files']} files ({others}).",
    ]
    readme = _readme_line(facts["readme"])
    if readme:
        bullets.append(f"**From the README:** {readme}")
    bullets.append(
        f"**Stack:** {', '.join(facts['declared'][:8]) or 'no declared dependencies'}; "
        f"{facts['external_count']} external packages imported "
        f"({counts['internal']} internal, {counts['stdlib']} standard-library, {counts['external']} external imports)."
    )
    hotspots = ", ".join(f"`{path}` ({n})" for path, n in facts["hotspots"][:3])
    bullets.append(
        f"**Structure:** {'most imported: ' + hotspots if hotspots else 'no internal imports between files'}; "
        f"{len(facts['cycles'])} import cycle{'s' if len(facts['cycles']) != 1 else ''}."
    )
    if facts["analysed"]:
        severity = ", ".join(f"{n} {s}" for s, n in sorted(facts["severity_counts"].items(), key=lambda i: SEVERITY_RANK.get(i[0], 9)))
        top = facts["top_findings"][0] if facts["top_findings"] else None
        risk = f"{facts['findings_total']} findings ({severity})" if facts["findings_total"] else "the analyzers found nothing"
        if top:
            risk += f"; most severe: {top['title']} in `{top['file']}`"
        bullets.append(f"**Risks:** {risk}.")
    else:
        bullets.append("**Risks:** run an analysis to list findings.")
    start = [f"`{p}`" for p in facts["entry_points"][:3]] or [f"`{p}`" for p, _ in facts["hotspots"][:1]]
    bullets.append(f"**Where to start:** {', '.join(start) if start else 'the README'}.")
    return "\n".join(f"- {bullet}" for bullet in bullets)


from utils.ruff_analyzer import run_ruff_analysis
from utils.bandit_analyzer import run_bandit_analysis
from utils.semgrep_analyzer import run_semgrep_analysis
from utils.gitleaks_analyzer import run_gitleaks_analysis

from utils.finding_normalizer import normalize_findings
from utils.finding_deduplicator import deduplicate_findings


def run_all_analyzers(target_path):
    """
    Execute all analyzers, normalize findings and consolidate duplicates.

    A failure in one analyzer will not stop the others.
    """

    analyzers = {
        "Ruff": run_ruff_analysis,
        "Bandit": run_bandit_analysis,
        "Semgrep": run_semgrep_analysis,
        "Gitleaks": run_gitleaks_analysis
    }

    raw_findings = []
    tool_status = {}

    for tool_name, analyzer in analyzers.items():

        try:
            findings = analyzer(target_path)

            if not isinstance(findings, list):
                raise ValueError(
                    f"{tool_name} returned an invalid findings format."
                )

            raw_findings.extend(findings)

            tool_status[tool_name] = {
                "status": "Completed",
                "findings": len(findings),
                "error": None
            }

        except Exception as error:

            tool_status[tool_name] = {
                "status": "Failed",
                "findings": 0,
                "error": str(error)
            }

    # Step 1: Normalize all analyzer outputs.
    normalized_findings = normalize_findings(raw_findings)

    # Step 2: Consolidate duplicate issues.
    consolidated_findings = deduplicate_findings(
        normalized_findings
    )

    return {
        # Dashboard-facing consolidated findings.
        "findings": consolidated_findings,

        # Original analyzer outputs for debugging and traceability.
        "raw_findings": raw_findings,

        "tool_status": tool_status,

        # Counts before and after consolidation.
        "raw_total_findings": len(raw_findings),
        "total_findings": len(consolidated_findings),

        "duplicates_removed": (
            len(raw_findings) - len(consolidated_findings)
        )
    }

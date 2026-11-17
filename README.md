# CodeLens AI 🔍

**AI-Powered Code Analysis and Repository Intelligence**

CodeLens AI is a Python-based code analysis application designed to help developers understand, inspect, and improve their codebases. It combines static analysis tools with AI-powered assistance to identify potential security vulnerabilities, code quality issues, and areas that need attention.

The application provides a centralized interface for analyzing source code and reviewing findings from multiple analysis tools.

## ✨ Features

### 1. Repository and File Analysis
- Upload individual source code files.
- Import repositories for analysis.
- Support for ZIP-based repository uploads.
- Import repositories using a GitHub URL.
- Extract and process source files for analysis.

### 2. Static Code Analysis

CodeLens AI integrates four analysis tools:

| Tool | Purpose |
|---|---|
| Ruff | Python linting and code quality checks |
| Bandit | Detection of common Python security issues |
| Semgrep | Pattern-based static code analysis |
| Gitleaks | Detection of hardcoded secrets and credentials |

### 3. Finding Normalization and Deduplication
- Consolidates findings from multiple analysis tools.
- Identifies overlapping findings to reduce duplicate alerts.
- Preserves information about the tools that detected each issue.
- Normalizes severity and confidence information.
- Provides structured findings for easier review.

### 4. Analysis Dashboard
- Displays the total number of findings.
- Provides severity-wise summaries.
- Shows analyzer execution status.
- Displays individual findings and their associated details.
- Helps developers prioritize issues.

### 5. AI-Powered Assistance
- Uses an LLM integration to support code understanding and analysis.
- Provides AI-assisted explanations and summaries through the application.

### 6. Report Generation
- Generates structured JSON analysis reports.
- Generates HTML reports for reviewing analysis results.
- Includes consolidated findings and analyzer execution details.

## 🛠️ Technology Stack

| Category | Technologies |
|---|---|
| Programming Language | Python |
| Frontend / UI | Streamlit |
| AI / LLM Integration | Groq |
| Code Quality | Ruff |
| Security Analysis | Bandit, Semgrep |
| Secret Detection | Gitleaks |
| Data Processing | Python, JSON |
| Version Control | Git, GitHub |

## 📁 Project Structure

```text
CodeLens-AI/
│
├── app.py
│
├── prompts/
│   └── prompts.py
│
├── utils/
│   ├── analysis_engine.py
│   ├── bandit_analyzer.py
│   ├── file_handler.py
│   ├── finding_deduplicator.py
│   ├── finding_normalizer.py
│   ├── gitleaks_analyzer.py
│   ├── llm.py
│   ├── parser.py
│   ├── ruff_analyzer.py
│   ├── security.py
│   ├── semgrep_analyzer.py
│   └── severity_classifier.py
│
├── test_bandit.py
├── test_llm.py
├── test_ruff.py
│
├── uploads/              # Runtime uploads (not committed)
├── .env                  # Environment variables (not committed)
├── .gitignore
├── requirements.txt
└── README.md
```

## ⚙️ Installation and Setup

### Prerequisites

- Python 3.10 or later
- Git
- Groq API key
- Ruff
- Bandit
- Semgrep
- Gitleaks

### 1. Clone the Repository

```bash
git clone <your-github-repository-url>
cd CodeLens-AI
```

### 2. Create a Virtual Environment

```bash
python -m venv venv
```

Activate it:

**Windows:**

```powershell
venv\Scripts\activate
```

**Linux / macOS:**

```bash
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Create a `.env` file in the project root and add your Groq API key:

```env
GROQ_API_KEY=your_groq_api_key
```

Use the exact environment variable name expected by the current LLM implementation.

### 5. Install Analysis Tools

Install the external analysis tools if they are not already available in your environment.

```bash
pip install ruff bandit semgrep
```

Install Gitleaks separately using its official installation instructions:

https://github.com/gitleaks/gitleaks

Ensure all tools are accessible from your terminal.

### 6. Run the Application

```bash
python -m streamlit run app.py
```

The application will be available at:

```text
http://localhost:8501
```

## 🧪 Testing

The project includes individual test scripts for selected components:

```bash
python test_ruff.py
python test_bandit.py
python test_llm.py
```

These tests help verify the corresponding analyzer and LLM integration components.

## 🔄 Analysis Workflow

1. Import a source file or repository.
2. Extract and identify supported source files.
3. Execute the configured static analysis tools.
4. Collect findings from individual analyzers.
5. Normalize and consolidate overlapping findings.
6. Classify findings by severity and confidence.
7. Display results through the Streamlit dashboard.
8. Generate JSON and HTML reports.

## 🚀 Future Enhancements

The project is being developed in phases, with planned improvements including:

- Modern frontend and backend architecture.
- More comprehensive repository understanding.
- Automated architecture and dependency analysis.
- Data-flow visualization.
- Improved bug and logic issue detection.
- Agentic workflows for repository-level analysis.
- Context-aware codebase question answering.
- More detailed repository intelligence reports.

## 🎯 Project Goal

The goal of CodeLens AI is to move beyond isolated code checks and build an intelligent development assistant that helps developers understand their repositories, identify potential problems, and make informed improvements.

---

**CodeLens AI — Understand Your Code. Detect Issues. Build Better Software.**
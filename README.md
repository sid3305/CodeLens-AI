# CodeLens AI

### AI-Powered Repository Intelligence & Code Analysis Platform

CodeLens AI is an AI-powered repository intelligence platform designed to help developers understand, analyze, and improve their codebases.

It combines static code analysis, repository parsing, dependency analysis, and Large Language Model (LLM) capabilities to provide insights into software repositories through a centralized workspace.

Instead of manually navigating hundreds of files, developers can import a repository, explore its structure, understand its functionality, identify potential security vulnerabilities, inspect dependencies, and interact with AI-powered code explanations.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Implemented Features](#implemented-features)
- [Technology Stack](#technology-stack)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Installation and Setup](#installation-and-setup)
- [Environment Configuration](#environment-configuration)
- [Running the Application](#running-the-application)
- [API Endpoints](#api-endpoints)
- [How It Works](#how-it-works)
- [Current Limitations](#current-limitations)
- [Future Roadmap](#future-roadmap)
- [Contributing](#contributing)

---

## Overview

Modern software repositories can contain hundreds or thousands of files, multiple programming languages, complex dependencies, and interconnected components.

Understanding an unfamiliar codebase or identifying potential issues manually can be time-consuming.

CodeLens AI aims to simplify this process by providing:

- Automated repository analysis.
- AI-generated repository summaries.
- Individual file explanations.
- Static security and code-quality analysis.
- Dependency and module relationship analysis.
- Repository exploration through a structured workspace.

The goal is to evolve CodeLens AI into an intelligent development assistant that understands the structure, functionality, and relationships within an entire software repository.

---

## Key Features

| Feature | Description |
|---|---|
| Repository Import | Import repositories using GitHub URLs or ZIP uploads. |
| Code Exploration | Browse repository files and inspect source code. |
| Repository Intelligence | Generate AI-powered summaries of repository functionality. |
| File Explanation | Understand individual files using AI-generated explanations. |
| Static Code Analysis | Detect potential bugs, security vulnerabilities, and code-quality issues. |
| Dependency Analysis | Examine external packages, internal modules, and circular dependencies. |
| Code Graph | Represent relationships between repository elements. |
| Analysis Dashboard | View findings, severity levels, and analysis statistics. |

---

## Implemented Features

### 1. Repository Import and Processing

CodeLens AI supports importing repositories through:

- GitHub repository URLs.
- ZIP file uploads.
- Repository extraction and validation.
- Source-file discovery and filtering.
- Repository file listing.
- Individual file content retrieval.

Imported repositories are stored in the application's workspace for further processing and analysis.

### 2. Static Code Analysis

The platform integrates multiple static analysis tools to identify potential problems in source code.

| Tool | Purpose |
|---|---|
| Ruff | Python linting and code-quality analysis. |
| Bandit | Detection of common Python security issues. |
| Semgrep | Pattern-based static code analysis. |
| Gitleaks | Detection of potentially exposed secrets and credentials. |

The analysis pipeline combines results from these tools into a unified findings structure.

Implemented capabilities include:

- Running multiple analyzers on an imported repository.
- Normalizing results into a common format.
- Deduplicating overlapping findings.
- Assigning severity and confidence information.
- Identifying source files and affected line numbers.
- Displaying findings through an analysis dashboard.
- Reporting findings by severity, including Critical, High, Medium, and Low.

### 3. AI-Powered Repository Summary

CodeLens AI integrates Groq-hosted LLMs to generate summaries of repository functionality.

The repository summary focuses on:

- What the project does.
- What problem it aims to solve.
- Its primary functionality.

Repository content is sanitized before being sent to the LLM to reduce the risk of exposing secrets.

### 4. AI-Powered File Explanation

Developers can request AI-generated explanations of individual source files.

The explanation feature is intended to help developers understand unfamiliar code without manually analyzing every function and statement.

### 5. Dependency Analysis

The dependency analysis module examines relationships between files and imported packages.

Implemented components include:

- Python and JavaScript/TypeScript parsing.
- Import extraction using Tree-sitter.
- Code graph construction.
- Dependency analysis using NetworkX.
- Circular dependency detection.
- External dependency identification.
- Internal module relationship analysis.
- Language-wise analysis statistics.
- Dependency graph data for frontend visualization.

**Note:** Dependency resolution and classification are still being refined. Standard-library classification, import-path resolution, and graph relationship accuracy require further testing.

### 6. Backend API

A FastAPI backend provides endpoints for repository management, file access, static analysis, AI features, and dependency analysis.

Implemented backend components include:

- Repository management services.
- Repository storage and metadata persistence.
- File retrieval and content handling.
- Static analysis services.
- AI summary and explanation services.
- Dependency analysis services.
- Pydantic request and response schemas.

### 7. Frontend Workspace

The frontend is being developed using React, TypeScript, and Vite.

The workspace is designed around a developer-friendly interface with repository navigation, analysis sections, and file exploration.

---

## Technology Stack

### Backend

| Technology | Purpose |
|---|---|
| Python | Core backend and analysis logic |
| FastAPI | REST API development |
| Pydantic | Data validation and response schemas |
| Tree-sitter | Source code parsing |
| NetworkX | Code and dependency graph analysis |
| Groq API | LLM-powered repository summaries and explanations |

### Static Analysis

- Ruff
- Bandit
- Semgrep
- Gitleaks

### Frontend

| Technology | Purpose |
|---|---|
| React | Frontend application |
| TypeScript | Type-safe frontend development |
| Vite | Development server and build tooling |
| Tailwind CSS | UI styling |
| Lucide React | Interface icons |

### Development Tools

- Git and GitHub
- Visual Studio Code
- Node.js and npm
- Python virtual environments

---

## System Architecture

CodeLens AI follows a frontend-backend architecture.

```text
                 USER
                   |
                   v
          React + TypeScript
             Frontend
                   |
                   v
              FastAPI
             Backend
                   |
       +-----------+-----------+
       |           |           |
       v           v           v
  Repository   AI Services  Analysis
  Management   (Groq API)   Services
       |           |           |
       |           |      +----+-----+
       |           |      |    |     |
       |           |    Ruff Bandit Semgrep
       |           |                Gitleaks
       |           |
       |           |
       v           v
  Repository    AI-generated
  Workspace     Insights
                   |
                   v
             API Responses
                   |
                   v
             Frontend UI
```

### Repository Processing Pipeline

```text
GitHub URL / ZIP Upload
          |
          v
Repository Import
          |
          v
File Discovery
          |
          v
Source Code Parsing
          |
          v
Repository Analysis
          |
     +----+----------------+
     |                     |
     v                     v
Static Analysis      Dependency Analysis
     |                     |
     v                     v
Findings             Dependency Graph
     |                     |
     +----------+----------+
                |
                v
          API Responses
                |
                v
           Frontend
```

---

## Project Structure

The project is organized into separate frontend, backend, analysis, and AI components.

```text
CodeLens-AI/
│
├── agents/
│   ├── repo_agent.py
│   └── explain_agent.py
│
├── prompts/
│   └── prompts.py
│
├── utils/
│   ├── file_handler.py
│   ├── parser.py
│   ├── security.py
│   │
│   └── code_graph/
│       ├── models.py
│       ├── graph_builder.py
│       ├── parser_factory.py
│       ├── python_parser.py
│       ├── javascript_parser.py
│       └── dependencies.py
│
├── backend/
│   ├── main.py
│   │
│   ├── routers/
│   │   ├── repositories.py
│   │   ├── analysis.py
│   │   ├── ai.py
│   │   └── dependencies.py
│   │
│   ├── services/
│   │   ├── repository_service.py
│   │   └── analysis_service.py
│   │
│   └── schemas/
│       ├── repository.py
│       ├── ai.py
│       └── dependencies.py
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
│
├── uploads/
│
├── requirements.txt
├── .env.example
├── .gitignore
└── README.md
```

*The structure above represents the main project components. Individual files and folders may change as development progresses.*

---

## Installation and Setup

Follow these steps to run CodeLens AI on your local machine.

### Prerequisites

Install the following before starting:

| Requirement | Purpose |
|---|---|
| Python 3.10+ | Backend |
| Node.js (LTS recommended) | Frontend |
| npm | Frontend dependencies |
| Git | Repository cloning and version control |
| Groq API Key | AI-powered features |

You can verify the installations using:

```bash
python --version
node --version
npm --version
git --version
```

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/CodeLens-AI.git
```

Navigate into the project:

```bash
cd CodeLens-AI
```

Replace `YOUR_USERNAME` with the GitHub account that hosts the repository.

### 2. Backend Setup

Create a Python virtual environment:

**Windows:**

```powershell
python -m venv venv
```

Activate it:

```powershell
.\venv\Scripts\Activate.ps1
```

If PowerShell blocks script execution, use:

```powershell
.\venv\Scripts\activate.bat
```

**Linux/macOS:**

```bash
python3 -m venv venv
source venv/bin/activate
```

Install Python dependencies:

```bash
pip install -r requirements.txt
```

### 3. Install Static Analysis Tools

The project uses external command-line analyzers.

Install the Python-based tools:

```bash
pip install ruff bandit semgrep
```

Install Gitleaks separately using its official installation instructions:

https://github.com/gitleaks/gitleaks

Make sure the analyzer commands are available in your system PATH.

Verify installations:

```bash
ruff --version
bandit --version
semgrep --version
gitleaks version
```

### 4. Frontend Setup

Open another terminal and navigate to the frontend directory:

```bash
cd frontend
```

Install frontend dependencies:

```bash
npm install
```

### 5. Environment Configuration

Create a `.env` file in the project root.

Add your Groq API key:

```env
GROQ_API_KEY=your_groq_api_key
```

Obtain an API key from:

https://console.groq.com/keys

**Important:**
- Never commit your `.env` file.
- Never expose API keys in frontend code.
- Keep API credentials on the backend.
- Use `.env.example` as a template if provided.

---

## Running the Application

CodeLens AI requires the backend and frontend development servers to run separately.

### Start the Backend

From the project root, activate your Python virtual environment and run:

```bash
uvicorn backend.main:app --reload
```

The backend will be available at:

```text
http://localhost:8000
```

FastAPI interactive API documentation:

```text
http://localhost:8000/docs
```

### Start the Frontend

Open a second terminal:

```bash
cd frontend
npm run dev
```

The Vite development server will typically be available at:

```text
http://localhost:5173
```

Open the frontend URL in your browser to access CodeLens AI.

---

## API Endpoints

The backend exposes REST endpoints for interacting with repositories and their analysis results.

The following table describes the main API operations; exact request parameters and response formats are available in the FastAPI documentation.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/repositories/...` | Repository import and management operations |
| GET | `/api/repositories/...` | Retrieve repository information and files |
| POST | `/api/repositories/{repo_id}/analyze` | Run static analysis |
| GET | `/api/repositories/{repo_id}/results` | Retrieve analysis results |
| POST | `/api/repositories/{repo_id}/summary` | Generate repository summary |
| POST | `/api/repositories/{repo_id}/explain` | Generate file explanation |
| GET/POST | `/api/repositories/{repo_id}/dependencies` | Dependency analysis operations |

Refer to `http://localhost:8000/docs` for the registered routes and their exact specifications.

---

## How It Works

### Static Analysis Pipeline

1. A repository is imported into the workspace.
2. Supported source files are discovered.
3. Ruff, Bandit, Semgrep, and Gitleaks analyze the repository.
4. Their results are collected.
5. Findings are normalized into a common structure.
6. Duplicate findings are filtered.
7. Severity and confidence information are assigned.
8. Results are returned to the frontend for visualization.

### AI Repository Summary

1. Repository source files are collected.
2. Content is sanitized to reduce secret exposure.
3. Repository content is passed to the Groq API.
4. The LLM generates a concise summary.
5. The summary is returned to the frontend.

### Dependency Analysis

1. Source files are parsed using Tree-sitter.
2. Import statements and code elements are extracted.
3. Nodes and relationships are constructed.
4. NetworkX is used to analyze the dependency graph.
5. Dependency statistics and graph data are returned to the frontend.

---

## Current Limitations

CodeLens AI is actively under development. Some features are implemented while others require additional refinement.

Current areas requiring improvement include:

- More accurate internal import resolution.
- Better distinction between standard-library and third-party dependencies.
- Improved dependency graph relationship handling.
- Broader support for import styles and programming languages.
- More extensive testing of dependency analysis.
- Further integration and refinement of frontend features.

The current static analysis system identifies patterns and findings reported by its integrated tools. It does not guarantee detection of every possible vulnerability or bug.

AI-generated summaries and explanations may also require developer verification.

---
License

This project is currently under development. Licensing information can be added when the repository license is finalized.

CodeLens AI — Understand your codebase. Analyze its structure. Improve your code.
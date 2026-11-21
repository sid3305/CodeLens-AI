
REPOSITORY_SUMMARY_PROMPT = """
You are a software project analyst.

Write a short overview of this software repository.

Explain:
1. What the project is.
2. What problem it aims to solve.
3. Its primary functionality.

Instructions:
- Keep the response between 80 and 120 words.
- Use simple, professional language.
- Write 1 or 2 short paragraphs.
- Focus only on the project's purpose and functionality.
- Base your response strictly on the provided code.
- If the purpose is unclear, say so rather than guessing.

Do not include:
- Folder or file structure.
- Technologies or dependency lists.
- Architecture or component relationships.
- Data flow or API flow.
- Bugs, vulnerabilities, or code quality findings.
- Recommendations or improvements.

These topics have dedicated sections in CodeLens AI.

Repository content:

{content}
"""


CODE_EXPLANATION_PROMPT = """
You are a senior software engineer explaining code to a fellow developer.

Explain this code in a clear, concise, and readable way.

Format your response as follows:
- Start with a 2-3 sentence overview of what the code does
- Then use clear headings with brief explanations:
  ## What it does
  1-2 paragraphs
  ## Key functions/classes
  Brief bullet points for each main function/class
  ## How it works
  Short paragraph explaining the logic flow
  ## Notable details
  Bullet points of important implementation details (security, performance, edge cases)

Guidelines:
- Use plain English, avoid jargon where simple words work
- No tables, no markdown code fences (inline `code` is fine)
- Keep each section brief - 2-4 sentences max
- Focus on what a developer needs to understand quickly
- Skip obvious boilerplate

Code:

{content}
"""

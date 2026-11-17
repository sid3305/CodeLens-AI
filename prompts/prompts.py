REPOSITORY_SUMMARY_PROMPT = """
You are an expert software architect.

Analyze this repository and provide:

1. Project purpose
2. Folder structure overview
3. Technologies/frameworks detected
4. High-level architecture summary
5. Important observations

Repository content:

{content}
"""


CODE_EXPLANATION_PROMPT = """
You are a senior software engineer.

Explain this code clearly.

Include:
1. What the code does
2. Function/class responsibilities
3. Logic flow
4. Important implementation details

Code:

{content}
"""
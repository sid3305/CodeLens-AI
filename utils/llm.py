
import os

from groq import Groq

# Importing config loads the project's .env file.
import utils.config  # noqa: F401

MODEL_NAME = "openai/gpt-oss-120b"


def call_llm(prompt, max_tokens=2048):

    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        raise ValueError("GROQ_API_KEY is missing from .env")

    client = Groq(api_key=api_key)

    try:
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=max_tokens
        )

        return response.choices[0].message.content

    except Exception as e:
        raise RuntimeError(
            f"Groq API Error: {e!s}"
        ) from e

from utils.llm import call_llm

prompt = "Explain what Python is in 3 lines."

response = call_llm(prompt)

print(response)
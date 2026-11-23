import subprocess

password = "hardcoded_password123"

def run_command(user_input):
    return subprocess.call(user_input, shell=True)
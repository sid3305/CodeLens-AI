def read_file_content(file_path):
    """
    Safely read file content.
    """

    try:

        with open(
            file_path,
            "r",
            encoding="utf-8"
        ) as f:

            return f.read()

    except Exception as e:

        return f"Error reading file: {str(e)}"
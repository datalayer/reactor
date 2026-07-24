# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from reactor import create_reactor_app

app = create_reactor_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8787)

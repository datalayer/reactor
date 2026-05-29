from datalayer_reactor import create_platform_app

app = create_platform_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8787)

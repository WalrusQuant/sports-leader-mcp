def test_lab_stack_imports():
    import duckdb
    import lightgbm
    import pandas
    import pyarrow
    import sklearn
    from mcp.server import MCPServer

    assert duckdb.__version__
    assert pandas.__version__
    assert pyarrow.__version__
    assert sklearn.__version__
    assert lightgbm.__version__
    assert MCPServer.__name__ == "MCPServer"

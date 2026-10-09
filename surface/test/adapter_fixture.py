"""Invoke an exported released adapter in the visual test's private fixture.

No adapter is installed or restarted. The JS test exports only the two required
modules from the pinned mobile_build commit into a disposable private package.
"""
import asyncio
import importlib
import json
import sys

sys.path.insert(0, sys.argv[1])
Reviews = importlib.import_module("relay_adapter.reviews").Reviews

try:
    result = asyncio.run(Reviews(port=int(sys.argv[2])).call(sys.argv[3], json.loads(sys.argv[4])))
    print(json.dumps(result))
except Exception as error:
    print(json.dumps({"code": getattr(error, "code", ""), "error": str(error)}))
    raise SystemExit(1)

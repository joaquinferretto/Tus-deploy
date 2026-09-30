"""Bounded MCP smoke checks; no credentials or tool payloads are printed.

Run with the Python interpreter providing the MCP SDK (Windows: py).
Servers are owned by the SDK context and closed before exit.
"""
import argparse
import asyncio
import json
import logging
import os
from contextlib import AsyncExitStack
from pathlib import Path
from datetime import timedelta

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

ROOT = Path(__file__).resolve().parents[2]
logging.disable(logging.CRITICAL)


async def check(name, config, inspect_only):
    async with AsyncExitStack() as stack:
        log = stack.enter_context(open(os.devnull, 'w'))
        if 'serverUrl' in config:
            streams = await stack.enter_async_context(streamablehttp_client(
                config['serverUrl'], timeout=20, sse_read_timeout=35))
        else:
            streams = await stack.enter_async_context(stdio_client(StdioServerParameters(
                command=config['command'], args=config.get('args', []),
                env=config.get('env'), cwd=config.get('cwd', str(ROOT))), errlog=log))
        session = await stack.enter_async_context(ClientSession(
            streams[0], streams[1], read_timeout_seconds=timedelta(seconds=35)))
        init = await session.initialize()
        tools = (await session.list_tools()).tools
        if inspect_only:
            return {'server': name, 'version': init.serverInfo.version,
                    'tools': [{'name': t.name, 'schema': t.inputSchema} for t in tools]}

        async def call(tool, args):
            result = await session.call_tool(tool, args)
            if result.isError:
                raise RuntimeError('tool returned isError: ' + tool)
            return '\n'.join(c.text for c in result.content if hasattr(c, 'text'))

        if name == 'filesystem':
            await call('list_directory', {'path': str(ROOT)})
            assert 'TUS' in await call('read_text_file', {'path': str(ROOT / 'ARCHITECTURE.md'), 'head': 5})
        elif name == 'git':
            await call('git_status', {'repo_path': str(ROOT)})
        elif name == 'fetch':
            assert 'Example Domain' in await call('fetch', {'url': 'https://example.com', 'max_length': 1000})
        elif name == 'time':
            await call('get_current_time', {'timezone': 'America/Argentina/Cordoba'})
            await call('convert_time', {'source_timezone': 'UTC', 'time': '12:00', 'target_timezone': 'America/Argentina/Cordoba'})
        elif name == 'sequential_thinking':
            await call('sequentialthinking', {'thought': 'Connectivity smoke check complete.', 'nextThoughtNeeded': False, 'thoughtNumber': 1, 'totalThoughts': 1})
        elif name == 'engram':
            await call('mem_current_project', {})
        elif name == 'memory':
            import uuid
            marker = 'tus-mcp-smoke-' + str(uuid.uuid4())
            try:
                await call('create_entities', {'entities': [{'name': marker, 'entityType': 'temporary-test', 'observations': ['Harmless connectivity test.']}]})
                assert marker in await call('open_nodes', {'names': [marker]})
            finally:
                await call('delete_entities', {'entityNames': [marker]})
            assert marker not in await call('open_nodes', {'names': [marker]})
        elif name == 'context7':
            result = await call('resolve-library-id', {'libraryName': 'react', 'query': 'React useState basic usage'})
            assert 'react' in result.lower()
            import re
            library = re.search(r'Context7-compatible library ID:\s*(/[^\s]+)', result, re.IGNORECASE)
            if not library:
                raise RuntimeError('No library ID returned')
            assert 'useState' in await call('query-docs', {
                'libraryId': library.group(1), 'query': 'Basic useState example'})
        elif name == 'gh_grep':
            await call('searchGitHub', {'query': 'useState(', 'repo': 'facebook/react', 'language': ['TypeScript']})
        elif name == 'playwright':
            try:
                assert 'Example Domain' in await call('browser_navigate', {'url': 'https://example.com'})
                await call('browser_console_messages', {'level': 'error'})
                await call('browser_resize', {'width': 390, 'height': 844})
            finally:
                await call('browser_close', {})
        else:
            raise ValueError('No smoke operation defined')
        return {'server': name, 'status': 'PASS', 'version': init.serverInfo.version, 'tool_count': len(tools)}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('servers', nargs='*')
    parser.add_argument('--inspect', action='store_true')
    args = parser.parse_args()
    configs = json.loads((ROOT / '.agents/mcp_config.json').read_text(encoding='utf-8-sig'))['mcpServers']
    failed = False
    for name in args.servers or configs:
        try:
            result = await asyncio.wait_for(check(name, configs[name], args.inspect), timeout=65)
        except Exception as exc:
            failed = True
            result = {'server': name, 'status': 'FAIL', 'error_type': type(exc).__name__}
        print(json.dumps(result), flush=True)
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))

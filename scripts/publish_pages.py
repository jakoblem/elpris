#!/usr/bin/env python3
"""Request and verify branch-based Pages builds, including after a bot commit."""
import json
import os
import subprocess
import time

from data_utils import diagnostic, summary


def api(path, method="GET"):
    result = subprocess.run(
        ["gh", "api", "--method", method, path], capture_output=True, text=True,
        check=True, timeout=45,
    )
    return json.loads(result.stdout)


def publish(repository, commit, attempts=20, poll_seconds=15):
    endpoint = f"repos/{repository}/pages"
    site = api(endpoint)
    if site.get("source") != {"branch": "main", "path": "/"} or site.get("build_type") != "legacy":
        raise RuntimeError("Expected Pages source main / (Deploy from a branch); check Settings > Pages")
    latest = api(endpoint + "/builds/latest")
    if latest.get("commit") == commit and latest.get("status") == "built":
        summary(f"GitHub Pages already built {commit}")
        return
    if latest.get("commit") != commit or latest.get("status") not in ("queued", "building"):
        # A GITHUB_TOKEN push alone does not guarantee a Pages build.
        api(endpoint + "/builds", "POST")
    for attempt in range(attempts):
        latest = api(endpoint + "/builds/latest")
        if latest.get("commit") == commit:
            if latest.get("status") == "built":
                summary(f"GitHub Pages built {commit}: {site.get('html_url', '')}")
                return
            if latest.get("status") == "errored":
                raise RuntimeError(f"Pages build failed: {latest.get('error')}")
        if attempt < attempts - 1:
            time.sleep(poll_seconds)
    raise RuntimeError(f"Pages did not confirm build of {commit}; next scheduled run will retry")


def main():
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        publish(os.environ["GITHUB_REPOSITORY"], commit)
        return 0
    except Exception as exc:
        diagnostic("error", f"Pages publication not confirmed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

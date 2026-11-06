#!/usr/bin/env python3
"""Idempotently add/list an NPM proxy host. Run ON THE SERVER.
Usage: npm_host.py list | add <domain> <forward_host> <port> [conf_id]
Prints the proxy host id used for the conf filename."""
import json
import sqlite3
import sys
import time
import os

DB = os.path.expanduser('~/nginxproxymanager/data/database.sqlite')


def main():
    mode = sys.argv[1]
    db = sqlite3.connect(DB)
    if mode == 'list':
        for row in db.execute('select id, domain_names, forward_host, forward_port, enabled from proxy_host'):
            print(row)
        return
    if mode == 'add':
        domain, forward_host, port = sys.argv[2], sys.argv[3], int(sys.argv[4])
        existing = db.execute(
            'select id from proxy_host where domain_names like ?', (f'%{domain}%',)
        ).fetchone()
        if existing:
            print(f'exists {existing[0]}')
            return
        cur = db.execute(
            '''insert into proxy_host
               (created_on, modified_on, domain_names, forward_scheme, forward_host, forward_port,
                caching_enabled, block_exploits, allow_websocket_upgrade, http2_support,
                hsts_enabled, hsts_subdomains, certificate_id, ssl_forced, enabled, locations,
                hsts_preload, letsencrypt_certificate_id)
               values (?,?,?,?,?,?,0,0,0,0,0,0,0,1,'[]',0,0)''',
            (int(time.time()), int(time.time()), json.dumps([domain]), 'http', forward_host, port),
        )
        db.commit()
        print(f'inserted {cur.lastrowid}')


if __name__ == '__main__':
    main()

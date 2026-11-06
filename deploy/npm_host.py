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
        now = time.strftime('%Y-%m-%d %H:%M:%S')
        cur = db.execute(
            '''insert into proxy_host
               (created_on, modified_on, owner_user_id, is_deleted, domain_names,
                forward_host, forward_port, access_list_id, certificate_id, ssl_forced,
                caching_enabled, block_exploits, advanced_config, meta,
                allow_websocket_upgrade, http2_support, forward_scheme, enabled,
                locations, hsts_enabled, hsts_subdomains, trust_forwarded_proto)
               values (:created_on, :modified_on, 1, 0, :domain_names,
                :forward_host, :forward_port, 0, 0, 0,
                0, 0, '', :meta,
                0, 0, 'http', 1,
                '[]', 0, 0, 0)''',
            {
                'created_on': now,
                'modified_on': now,
                'domain_names': json.dumps([domain]),
                'forward_host': forward_host,
                'forward_port': port,
                'meta': '{"nginx_online":true,"nginx_err":null}',
            },
        )
        db.commit()
        print(f'inserted {cur.lastrowid}')


if __name__ == '__main__':
    main()

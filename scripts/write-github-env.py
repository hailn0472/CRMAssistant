#!/usr/bin/env python3
import json
import re
import sys
import uuid

ENV_KEY_PATTERN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def write_env_line(output, key, value):
    if not ENV_KEY_PATTERN.match(key):
        raise ValueError(f'Invalid environment variable name: {key}')

    value = '' if value is None else str(value)
    if '\n' in value:
        delimiter = f'EOF_{uuid.uuid4().hex}'
        output.write(f'{key}<<{delimiter}\n{value}\n{delimiter}\n')
    else:
        output.write(f'{key}={value}\n')


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: write-github-env.py <infisical-json> <github-env-file>')

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    with open(input_path, encoding='utf-8') as input_file:
        secrets = json.load(input_file)

    if not isinstance(secrets, list):
        raise ValueError('Infisical JSON export must be a list of secret objects')

    with open(output_path, 'a', encoding='utf-8') as output_file:
        for secret in secrets:
            if not isinstance(secret, dict):
                continue
            key = secret.get('key')
            if not isinstance(key, str):
                continue
            write_env_line(output_file, key, secret.get('value'))


if __name__ == '__main__':
    main()

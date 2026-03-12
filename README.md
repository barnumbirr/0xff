# `0xff`

A tiny, serverless URL shortener built on Cloudflare Workers and Workers KV.  

Heavily inspired by [`Erisa/worker-links`](https://github.com/Erisa/worker-links)
and [`VandyHacks/vhl.ink`](https://github.com/VandyHacks/vhl.ink).

## Usage

Shorten a URL:
```bash
curl -X POST -H "Authorization: $SECRET_KEY" -H "URL: https://example.com" https://0xff.tf
```

Custom short URL:
```bash
curl -X PUT -H "Authorization: $SECRET_KEY" -H "URL: https://example.com" https://0xff.tf/example
```

Update target URL:
```bash
curl -X PATCH -H "Authorization: $SECRET_KEY" -H "URL: https://new-example.com" https://0xff.tf/example
```

Delete a URL:
```bash
curl -X DELETE -H "Authorization: $SECRET_KEY" https://0xff.tf/example
```

List all URLs:
```bash
curl -X GET -H "Authorization: $SECRET_KEY" https://0xff.tf
```

Set a TTL (expiration in seconds, minimum 60):
```bash
curl -X POST -H "Authorization: $SECRET_KEY" -H "URL: https://example.com" -H "TTL: 86400" https://0xff.tf
```

Preview a URL (returns JSON instead of redirecting):
```bash
curl https://0xff.tf/example?preview
```

Get a QR code (returns SVG):
```bash
curl https://0xff.tf/example.qr
```

## License

```
Copyright 2022-2026 Martin Simon

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

```

## Buy me a coffee?

If you feel like buying me a coffee (or a beer?), donations are welcome:

```
BTC : bc1qq04jnuqqavpccfptmddqjkg7cuspy3new4sxq9
DOGE: DRBkryyau5CMxpBzVmrBAjK6dVdMZSBsuS
ETH : 0x2238A11856428b72E80D70Be8666729497059d95
LTC : MQwXsBrArLRHQzwQZAjJPNrxGS1uNDDKX6
```

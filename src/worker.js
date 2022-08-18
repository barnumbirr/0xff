import html from "./index.html"

addEventListener('fetch', event => {
  const { request } = event;

  switch (request.method) {
    case 'DELETE':
      return event.respondWith(handleDELETE(request));
    case 'POST':
      return event.respondWith(handlePOST(request));
    case 'PUT':
      return event.respondWith(handlePUT(request));
    default:
      return event.respondWith(handleRequest(request, event));
  }
});

async function handlePOST(request) {
  const secret = request.headers.get('Authorization');
  if (secret !== SECRET_KEY)
    return Response.json(
      {
        code: '401 Unauthorized',
        message: 'Unauthorized.'
      },
      {
        status: 401
      }
    );

  const url = request.headers.get('URL')
  const slug = '/' + Math.random().toString(36).slice(5)
  const shorturl = new URL(request.url).origin + slug

  try {
    new URL(shorturl);
  } catch (TypeError) {
    if (e instanceof TypeError)
      return Response.json(
        {
          code: '400 Bad Request',
          message: '`URL` needs to be a valid HTTP URL.'
        },
        {
          status: 400
        }
      );
    throw e;
  };

  await kv.put(slug, url);
  return Response.json(
    {
      message: 'URL created successfully.',
      slug: slug.substr(1),
      short: shorturl,
      long: url
    },
    {
      status: 200
    }
  );
}

async function handlePUT(request) {
  const secret = request.headers.get('Authorization');
  if (secret !== SECRET_KEY)
    return Response.json(
      {
        code: '401 Unauthorized',
        message: 'Unauthorized.'
      },
      {
        status: 401
      }
    );

  const url = request.headers.get('URL')
  const slug = new URL(request.url).pathname
  const shorturl = new URL(request.url).origin + slug

  if (!slug)
    return Response.json(
      {
        code: '400 Bad Request',
        message: '`slug` needs to be set.'
      },
      {
        status: 401
      }
    );

  try {
    new URL(shorturl);
  } catch (e) {
    if (e instanceof TypeError)
      return Response.json(
        {
          code: '400 Bad Request',
          message: '`URL` needs to be a valid HTTP URL.'
        },
        {
          status: 400
        }
      );
    else throw e;
  };

  if(await kv.get(slug) !== null)
    return Response.json(
      {
        code: '409 Conflict',
        message: '`slug` already exists.'
      },
      {
        status: 409
      }
    );

  await kv.put(slug, url);
  return Response.json(
    {
      message: 'URL created succesfully.',
      slug: slug.substr(1),
      short: shorturl,
      long: url
    },
    {
      status: 200
    }
  );
}

async function handleDELETE(request) {
  const secret = request.headers.get('Authorization');
  if (secret !== SECRET_KEY)
    return Response.json(
      {
        code: '401 Unauthorized',
        message: 'Unauthorized.'
      },
      {
        status: 401
      }
    );

  const slug = new URL(request.url).pathname
  const shorturl = new URL(request.url).origin + slug
  let url = await kv.get(slug);
  if (!url)
    return Response.json(
      {
        code: '404 Not Found',
        message: '`slug` does not exist.'
      },
      {
        status: 404,
      }
    );
  await kv.delete(slug);
  return Response.json(
    {
      message: 'URL deleted succesfully.',
      slug: slug.substr(1),
      short: shorturl,
      long: url
    },
    {
      status: 200
    }
  );
}

async function handleRequest(request, event) {
  const root = new URL(request.url).origin
  const slug = new URL(request.url).pathname
  if (slug == '/') {
    const secret = request.headers.get('Authorization');
    if (secret === SECRET_KEY) {
      const list = await kv.list();
      const keys = list.keys;

      for (let i = 0; i < keys.length; i++) {
        const name = keys[i].name;
        const value = await kv.get(name);
        const metadata = keys[i].metadata;
        const expiration = keys[i].expiration;

        keys[i].short = root + keys[i].name;
        keys[i].long = value;
        keys[i].metadata = metadata;
        keys[i].expiration = expiration;
      }

      return new Response(JSON.stringify(keys), { status: 200 });
    }

    return new Response(html, {
      headers: {
        'content-type': 'text/html',
      },
    });
  }

  const redirectURL = await kv.get(slug);
  if (!redirectURL)
    return Response.json(
      {
        code: '404 Not Found',
        message: '`slug` does not exist.'
      },
      {
        status: 404
      }
    );

    return new Response(null,{ status: 302, headers: { Location: redirectURL } });
}

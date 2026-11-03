// Fixture with all three handler kinds, for the lookup order (onRequest<Method> first, then onRequest)
// and for what the server hands a function.

// GET echoes the request as the function sees it and sets two cookies. The first one has a comma in
// its Expires date, which is what breaks a server that joins Set-Cookie headers.
export const onRequestGet = ({ request, params, data }) => {
  const headers = new Headers();
  headers.append('Set-Cookie', 'a=1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly');
  headers.append('Set-Cookie', 'b=2; Path=/api; SameSite=Strict');
  return Response.json(
    {
      url: request.url,
      ip: request.headers.get('cf-connecting-ip'),
      origin: request.headers.get('origin'),
      params,
      data,
    },
    { headers },
  );
};

// POST echoes the body.
export const onRequestPost = async ({ request }) =>
  Response.json({
    text: await request.text(),
    contentType: request.headers.get('content-type'),
    contentLength: request.headers.get('content-length'),
  });

// Every other method.
export const onRequest = ({ request }) => new Response(`any ${request.method}`);

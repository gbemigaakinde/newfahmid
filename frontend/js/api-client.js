/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Backend API Client
 */

import {
  getIdToken,
} from "./firebase-auth.js";

/**
 * Set this to the deployed Cloudflare Worker URL.
 *
 * During development you can use:
 *
 * http://localhost:8787
 *
 * Later:
 *
 * https://api.your-domain.com
 */
const API_BASE_URL =
  "http://localhost:8787";

/**
 * Build an API URL.
 */
function buildUrl(
  path,
) {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  return `${API_BASE_URL}${path}`;
}

/**
 * Make an authenticated API request.
 */
async function request(
  path,
  options = {},
) {
  const token =
    await getIdToken();

  const headers =
    new Headers(
      options.headers || {},
    );

  headers.set(
    "Authorization",
    `Bearer ${token}`,
  );

  headers.set(
    "Content-Type",
    "application/json",
  );

  const response =
    await fetch(
      buildUrl(path),
      {
        ...options,
        headers,
      },
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error =
      new Error(
        data?.message ||
          "The request failed.",
      );

    error.status =
      response.status;

    error.code =
      data?.error ||
      "REQUEST_FAILED";

    throw error;
  }

  return data;
}

/**
 * GET request.
 */
export function get(
  path,
) {
  return request(
    path,
    {
      method: "GET",
    },
  );
}

/**
 * POST request.
 */
export function post(
  path,
  body = {},
) {
  return request(
    path,
    {
      method: "POST",
      body:
        JSON.stringify(body),
    },
  );
}

/**
 * PUT request.
 */
export function put(
  path,
  body = {},
) {
  return request(
    path,
    {
      method: "PUT",
      body:
        JSON.stringify(body),
    },
  );
}

/**
 * PATCH request.
 */
export function patch(
  path,
  body = {},
) {
  return request(
    path,
    {
      method: "PATCH",
      body:
        JSON.stringify(body),
    },
  );
}

/**
 * DELETE request.
 */
export function del(
  path,
) {
  return request(
    path,
    {
      method: "DELETE",
    },
  );
}

export const api = {
  get,
  post,
  put,
  patch,
  delete: del,
};

import { Type, Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { UPSTREAM_BASE_URL, UPSTREAM_TIMEOUT_MS } from "./constants.js";

export const QueryPhotoUpstreamSchema = Type.Object({
  scrambleId: Type.Number(),
  name: Type.String(),
  id: Type.String(),
  images: Type.Array(
    Type.Object({
      name: Type.String(),
      url: Type.String(),
    }),
  ),
});

export type PhotoInfo = Static<typeof QueryPhotoUpstreamSchema>;

export enum QueryPhotoUpstreamError {
  UPSTREAM_RESPONSE_INVALID = "upstream_response_invalid",
  PHOTO_NOT_FOUND = "photo_not_found",
  UNKNOWN_ERROR = "unknown_error",
}

export async function queryPhotoUpstream(id: string) {
  const url = new URL(`/photo/${encodeURIComponent(id)}`, UPSTREAM_BASE_URL);

  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    UPSTREAM_TIMEOUT_MS,
  );
  try {
    const res = await fetch(url, { signal: abortController.signal });
    if (res.status === 200) {
      let parsed: Static<typeof QueryPhotoUpstreamSchema>;
      try {
        const bodyJSON = await res.json();
        parsed = Value.Parse(QueryPhotoUpstreamSchema, bodyJSON);
      } catch (err) {
        return {
          success: false as const,
          error: QueryPhotoUpstreamError.UPSTREAM_RESPONSE_INVALID,
        };
      }
      return { success: true as const, result: parsed };
    }
    if (res.status === 404) {
      return {
        success: false as const,
        error: QueryPhotoUpstreamError.PHOTO_NOT_FOUND,
      };
    }
    const message = await res.text();

    console.warn(
      `Unknown error when querying photo from upstream, statusCode = ${res.status}, message = ${message}`,
    );
    return {
      success: false as const,
      error: QueryPhotoUpstreamError.UNKNOWN_ERROR,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const QueryAlbumUpstreamSchema = Type.Object({
  id: Type.String(),
  description: Type.String(),
  totalViews: Type.String(),
  likes: Type.String(),
  author: Type.Array(Type.String()),
  tags: Type.Array(Type.String()),
  works: Type.Array(Type.String()),
  actors: Type.Array(Type.String()),
});
export type AlbumPhoto = Static<typeof QueryAlbumUpstreamSchema>;

export enum QueryAlbumUpstreamError {
  UPSTREAM_RESPONSE_INVALID = "upstream_response_invalid",
  ALBUM_NOT_FOUND = "album_not_found",
  UNKNOWN_ERROR = "unknown_error",
}

export async function queryAlbumUpstream(id: string) {
  const url = new URL(`/album/${encodeURIComponent(id)}`, UPSTREAM_BASE_URL);

  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    UPSTREAM_TIMEOUT_MS,
  );

  try {
    const res = await fetch(url, { signal: abortController.signal });
    if (res.status === 200) {
      let parsed: Static<typeof QueryAlbumUpstreamSchema>;
      try {
        const bodyJSON = await res.json();
        parsed = Value.Parse(QueryAlbumUpstreamSchema, bodyJSON);
      } catch (err) {
        return {
          success: false as const,
          error: QueryAlbumUpstreamError.UPSTREAM_RESPONSE_INVALID,
        };
      }
      return { success: true as const, result: parsed };
    }
    if (res.status === 404) {
      return {
        success: false as const,
        error: QueryAlbumUpstreamError.ALBUM_NOT_FOUND,
      };
    }
    const message = await res.text();

    console.warn(
      `Unknown error when querying album from upstream, statusCode = ${res.status}, message = ${message}`,
    );
    return {
      success: false as const,
      error: QueryAlbumUpstreamError.UNKNOWN_ERROR,
    };
  } finally {
    clearTimeout(timeout);
  }
}

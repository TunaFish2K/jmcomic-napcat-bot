import express from "express";
import {
  DEV_PORT,
  INFO_CACHE_MAX_KEYS,
  INFO_CACHE_TTL_SECONDS,
} from "./constants.js";
import {
  queryPhotoUpstream,
  queryAlbumUpstream,
  QueryPhotoUpstreamError,
  PhotoInfo,
  AlbumPhoto,
} from "./upstream.js";
import NodeCache from "node-cache";

const app = express();

app.get("/health", (req, res) => {
  res.json({
    alive: true,
  });
});

/**
 * 返回一个本子的标题，描述，作者，标签，点赞与评论数量，与封面。
 *
 * 一个album可以拥有多个photo，非多篇album与拥有唯一photo的id一致。
 *
 * 查询photoId获得标题和封面，尝试查询对应album获得作者，标签等数据，没有就不返回。
 *
 * 封面通过读取第一张图片，解密后编码为base64返回。
 */
app.get("/info/:id", async (req, res) => {
  const photoId = req.params.id;

  if (infoCache.has(photoId)) {
    const resData = infoCache.get(photoId);
    return res.json(resData);
  }

  let queryPhotoUpstreamResult!: Awaited<ReturnType<typeof queryPhotoUpstream>>;
  let queryAlbumUpstreamResult!: Awaited<
    ReturnType<typeof queryAlbumUpstream>
  > | null;

  async function queryPhotoAndOptionalAlbum() {
    await Promise.all([
      (async () => {
        queryPhotoUpstreamResult = await queryPhotoUpstream(photoId);
      })(),
      (async () => {
        try {
          queryAlbumUpstreamResult = await queryAlbumUpstream(photoId);
        } catch {
          queryAlbumUpstreamResult = null;
        }
      })(),
    ]);
  }

  try {
    await queryPhotoAndOptionalAlbum();
  } catch (err) {
    console.error(
      "Faced with unexpected error when querying photo from upstream:",
    );
    if (err instanceof Error) {
      console.error(err.stack);
    } else {
      console.error(err);
    }
    return res.status(500).end("Internal server error!");
  }
  if (!queryPhotoUpstreamResult.success) {
    switch (queryPhotoUpstreamResult.error) {
      case QueryPhotoUpstreamError.PHOTO_NOT_FOUND:
        return res.status(404).end("Photo not found!");
      case QueryPhotoUpstreamError.UPSTREAM_RESPONSE_INVALID:
        return res.status(500).end("Upstream Error");
      case QueryPhotoUpstreamError.UNKNOWN_ERROR:
      default:
        return res.status(500).end("Unknown Error");
    }
  }
  const photo = queryPhotoUpstreamResult.result;
  const album = queryAlbumUpstreamResult?.result ?? null;
  const info = combinePhotoAndAlbumToInfo(photo, album);
  const resData = { ...info };
  infoCache.set(photoId, resData);
  return res.json(resData);
});

function combinePhotoAndAlbumToInfo(
  photo: PhotoInfo,
  album: AlbumPhoto | null,
) {
  return {
    name: photo.name,
    description: album?.description ?? null,
    views: album?.totalViews ?? null,
    likes: album?.likes ?? null,

    authors: album?.author ?? null,
    tags: album?.tags ?? null,
    works: album?.works ?? null,
    actors: album?.actors ?? null,
  };
}

const infoCache = new NodeCache({
  stdTTL: INFO_CACHE_TTL_SECONDS,
  maxKeys: INFO_CACHE_MAX_KEYS,
});

const server = app.listen(DEV_PORT, (err) => {
  if (err) {
    console.log(`Error when binding the server: ${err.stack}`);
    console.log(`Quitting...`);
    return process.exit(1);
  }
  const address = server.address();
  if (address === null) {
    return console.warn("Failed to read the server address!");
  }
  if (typeof address === "string") {
    return console.log(`Listening at: ${server.address}`);
  }
  console.log(`Listening at: ${address.address}:${address.port}`);
});

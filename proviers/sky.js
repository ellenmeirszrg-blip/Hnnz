// SkyMoviesHD Nuvio Plugin - API + StreamTape resolver only
//
// PHP API does:
// TMDB -> title/year -> SkyMoviesHD -> SERVER 01 -> StreamTape URLs -> MySQL cache
//
// Plugin only:
// calls your PHP API -> resolves StreamTape -> returns successful tapecontent URLs

const API_BASE = "https://cluster.watchkar.com/skymovieshd.php";

const manifest = {
  id: "skymovieshd-api",
  name: "StreamTape",
  version: "2.0.0",
  supportedTypes: ["movie"]
};

async function resolveStreamTape(pageUrl) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*"
  };

  const normalizedUrl = String(pageUrl || "")
    .replace(/^https:\/\/streamtape\.to\//i, "https://tpead.net/");

  const pageRes = await fetch(normalizedUrl, {
    headers,
    redirect: "follow"
  });

  if (!pageRes.ok) {
    throw new Error("StreamTape page HTTP " + pageRes.status);
  }

  const html = await pageRes.text();

  const match = html.match(
    /norobotlink'\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(['"]([^'"]+)['"]\)((?:\.substring\(\d+\))+)/i
  );

  if (!match) {
    throw new Error("norobotlink script not found");
  }

  let prefix = match[1];
  let part = match[2];
  const operations = match[3];

  for (const m of operations.matchAll(/\.substring\((\d+)\)/g)) {
    part = part.substring(Number(m[1]));
  }

  let getVideoUrl = prefix + part;

  if (getVideoUrl.startsWith("//")) {
    getVideoUrl = "https:" + getVideoUrl;
  } else if (getVideoUrl.startsWith("/")) {
    getVideoUrl = new URL(getVideoUrl, normalizedUrl).href;
  }

  getVideoUrl += (getVideoUrl.includes("?") ? "&" : "?") + "dl=1";

  const videoRes = await fetch(getVideoUrl, {
    headers: {
      ...headers,
      "Referer": normalizedUrl
    },
    redirect: "follow"
  });

  if (!videoRes.ok && videoRes.status !== 206) {
    throw new Error("StreamTape video HTTP " + videoRes.status);
  }

  const finalUrl = videoRes.url;

  if (!/^https?:\/\/[^/]*tapecontent\.net\//i.test(finalUrl)) {
    throw new Error("Not a tapecontent URL");
  }

  return finalUrl;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  tmdbId = String(tmdbId || "").trim();
  mediaType = String(mediaType || "movie").toLowerCase();

  if (!/^\d+$/.test(tmdbId) || mediaType !== "movie") {
    return [];
  }

  try {
    const apiUrl =
      API_BASE +
      "?id=" +
      encodeURIComponent(tmdbId) +
      "&type=movie";

    const res = await fetch(apiUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Nuvio/SkyMoviesHD"
      }
    });

    if (!res.ok) return [];

    const data = await res.json();

    if (!data || !data.success || !Array.isArray(data.downloads)) {
      return [];
    }

    // Resolve in parallel for fast response.
    const resolved = await Promise.all(
      data.downloads.map(async item => {
        try {
          const finalUrl = await resolveStreamTape(item.url);

          return {
            name: "StreamTape",
            title: item.title || "StreamTape",
            url: finalUrl
          };
        } catch (_) {
          // Only successfully resolved links are returned.
          return null;
        }
      })
    );

    return resolved.filter(Boolean);
  } catch (_) {
    return [];
  }
}

module.exports = {
  manifest,
  getStreams,
  resolveStreamTape
};

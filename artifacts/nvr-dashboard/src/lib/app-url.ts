export function resolveAppBaseUrl(pathname = window.location.pathname): string {
  let path = pathname.replace(/\/[^/]*\.[^/]*$/, "/")
  path = path.replace(/\/+$/, "")
  return path === "/" ? "" : path
}

export function resolveAppUrl(rawUrl: string, pathname = window.location.pathname): string {
  if (!rawUrl || /^(?:[a-z]+:)?\/\//i.test(rawUrl) || /^(?:blob|data):/i.test(rawUrl)) {
    return rawUrl
  }

  const base = resolveAppBaseUrl(pathname)
  const relative = rawUrl.replace(/^\.\//, "").replace(/^\//, "")
  return `${base}/${relative}` || "/"
}

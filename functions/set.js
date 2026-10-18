/**
 * iOS Location Spoofer Web
 * 
 * Copyright (c) 2026 akudamatata (https://github.com/akudamatata/iOS-Location-Spoofer-Web)
 * Licensed under CC BY-NC-SA 4.0
 * ⚠️【特别声明】：本项目完全免费开源，严禁以任何形式进行二次售卖、转售、商业收费代搭建！
 */

import { DEFAULT_LOC, validLocation, readStoredLocation, requireService, jsonResponse, errorResponse, corsHeaders } from './_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const unavailable = requireService(request, env);
  if (unavailable) return unavailable;

  let data;
  try { data = await request.json(); } catch { return errorResponse('bad json'); }
  if (!validLocation(data, true)) return errorResponse('invalid location');
  try {
    const stored = await env.SPOOFER_DATA.get('loc', { type: 'json' });
    if (!stored && (!Object.hasOwn(data, 'latitude') || !Object.hasOwn(data, 'longitude'))) {
      return errorResponse('initial location requires latitude and longitude');
    }
    const current = stored ? readStoredLocation(stored) || stored : DEFAULT_LOC;
    const updated = { ...current };
    for (const key of Object.keys(DEFAULT_LOC)) {
      if (Object.hasOwn(data, key)) updated[key] = data[key];
    }
    if (!validLocation(updated)) return errorResponse('invalid stored location', 503);
    await env.SPOOFER_DATA.put('loc', JSON.stringify(updated));
    return jsonResponse(updated);
  } catch {
    return errorResponse('storage unavailable', 503);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

/**
 * iOS Location Spoofer Web
 * 
 * Copyright (c) 2026 akudamatata (https://github.com/akudamatata/iOS-Location-Spoofer-Web)
 * Licensed under CC BY-NC-SA 4.0
 * ⚠️【特别声明】：本项目完全免费开源，严禁以任何形式进行二次售卖、转售、商业收费代搭建！
 */

import { DEFAULT_LOC, validLocation, requireService, jsonResponse, errorResponse, corsHeaders } from '../_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const unavailable = requireService(request, env);
  if (unavailable) return unavailable;

  try {
    const favs = await env.SPOOFER_DATA.get('favorites', { type: 'json' }) || [];
    if (!Array.isArray(favs)) return errorResponse('invalid stored favorites', 503);
    return jsonResponse(favs);
  } catch {
    return errorResponse('storage unavailable', 503);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const unavailable = requireService(request, env);
  if (unavailable) return unavailable;

  let data;
  try { data = await request.json(); } catch { return errorResponse('bad json'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      typeof data.latitude !== 'number' || typeof data.longitude !== 'number' ||
      (data.name != null && typeof data.name !== 'string')) return errorResponse('invalid favorite');
  const location = { ...DEFAULT_LOC };
  for (const key of Object.keys(DEFAULT_LOC)) {
    if (data[key] != null) location[key] = data[key];
  }
  if (!validLocation(location)) return errorResponse('invalid location');
  try {
    let favs = [];
    if (env.SPOOFER_DATA) {
      favs = await env.SPOOFER_DATA.get('favorites', { type: 'json' }) || [];
    }

    if (!Array.isArray(favs)) return errorResponse('invalid stored favorites', 503);
    const fav = {
      id:                 crypto.randomUUID(),
      name:               (data.name || '未命名').slice(0, 30),
      latitude:           data.latitude,
      longitude:          data.longitude,
      altitude:           data.altitude           ?? null,
      horizontalAccuracy: data.horizontalAccuracy ?? null,
      verticalAccuracy:   data.verticalAccuracy   ?? null,
      createdAt:          new Date().toISOString()
    };
    
    favs.unshift(fav);
    if (favs.length > 100) favs.pop();

    if (env.SPOOFER_DATA) {
      await env.SPOOFER_DATA.put('favorites', JSON.stringify(favs));
    }

    return jsonResponse(fav);
  } catch (err) {
    return errorResponse('storage unavailable', 503);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

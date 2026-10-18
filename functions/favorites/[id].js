/**
 * iOS Location Spoofer Web
 * 
 * Copyright (c) 2026 akudamatata (https://github.com/akudamatata/iOS-Location-Spoofer-Web)
 * Licensed under CC BY-NC-SA 4.0
 * ⚠️【特别声明】：本项目完全免费开源，严禁以任何形式进行二次售卖、转售、商业收费代搭建！
 */

import { requireService, jsonResponse, errorResponse, corsHeaders } from '../_utils.js';

export async function onRequestDelete(context) {
  const { request, env, params } = context;

  const unavailable = requireService(request, env);
  if (unavailable) return unavailable;

  const id = params.id;
  
  try {
    let favs = await env.SPOOFER_DATA.get('favorites', { type: 'json' }) || [];
    if (!Array.isArray(favs)) return errorResponse('invalid stored favorites', 503);
    favs = favs.filter(f => f.id !== id);
    await env.SPOOFER_DATA.put('favorites', JSON.stringify(favs));
    return jsonResponse({ ok: true });
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

/**
 * iOS Location Spoofer Web
 * 
 * Copyright (c) 2026 akudamatata (https://github.com/akudamatata/iOS-Location-Spoofer-Web)
 * Licensed under CC BY-NC-SA 4.0
 * ⚠️【特别声明】：本项目完全免费开源，严禁以任何形式进行二次售卖、转售、商业收费代搭建！
 */

import { validLocation, requireService, jsonResponse, errorResponse, corsHeaders } from './_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const unavailable = requireService(request, env);
  if (unavailable) return unavailable;

  try {
    const loc = await env.SPOOFER_DATA.get('loc', { type: 'json' });
    if (!loc) return errorResponse('location not configured', 404);
    if (!validLocation(loc)) return errorResponse('invalid stored location', 503);
    return jsonResponse(loc);
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

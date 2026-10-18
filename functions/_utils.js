/**
 * iOS Location Spoofer Web
 * 
 * Copyright (c) 2026 akudamatata (https://github.com/akudamatata/iOS-Location-Spoofer-Web)
 * Licensed under CC BY-NC-SA 4.0
 * ⚠️【特别声明】：本项目完全免费开源，严禁以任何形式进行二次售卖、转售、商业收费代搭建！
 */

export const DEFAULT_LOC = {
  latitude:           39.90872,
  longitude:          116.39748,
  altitude:           44,
  horizontalAccuracy: 39,
  verticalAccuracy:   1000
};

export function authOk(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  return typeof env.TOKEN === 'string' && env.TOKEN.length > 0 && token === env.TOKEN;
}

export function requireService(request, env) {
  if (!env.TOKEN) return errorResponse('TOKEN not configured', 503);
  if (!authOk(request, env)) return errorResponse('unauthorized', 401);
  if (!env.SPOOFER_DATA) return errorResponse('storage not configured', 503);
  return null;
}

export function validLocation(data, partial = false) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(DEFAULT_LOC);
  if (partial && !keys.some(key => Object.hasOwn(data, key))) return false;
  return keys.every(key => {
    if (partial && !Object.hasOwn(data, key)) return true;
    const value = data[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (key === 'latitude') return Math.abs(value) <= 90;
    if (key === 'longitude') return Math.abs(value) <= 180;
    if (key.endsWith('Accuracy')) return value > 0;
    return true;
  });
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}

export function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

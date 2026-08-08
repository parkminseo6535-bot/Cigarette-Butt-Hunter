// JPEG EXIF에서 촬영 위치(GPS) 정보만 가볍게 추출하는 유틸 (외부 라이브러리 없이 직접 파싱)
export async function extractGpsFromImage(file) {
  try {
    if (!file || !/jpe?g/i.test(file.type)) return null;

    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    if (view.getUint16(0, false) !== 0xffd8) return null; // JPEG SOI 아님

    let offset = 2;
    while (offset < view.byteLength - 4) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);

      if (marker === 0xe1) {
        const segLength = view.getUint16(offset + 2, false);
        const segStart = offset + 4;
        const isExif = view.getUint32(segStart, false) === 0x45786966 && view.getUint16(segStart + 4, false) === 0x0000;
        if (isExif) return parseTiffForGps(view, segStart + 6);
        offset += 2 + segLength;
      } else if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
      } else if (marker === 0xda) {
        break; // Start Of Scan: 메타데이터 영역 끝
      } else {
        const segLength = view.getUint16(offset + 2, false);
        offset += 2 + segLength;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

function parseTiffForGps(view, tiffStart) {
  const byteOrder = view.getUint16(tiffStart, false);
  const little = byteOrder === 0x4949; // 'II' = little-endian, 'MM' = big-endian

  const ifd0Offset = view.getUint32(tiffStart + 4, little);
  const gpsIfdOffset = findTagValue(view, tiffStart, tiffStart + ifd0Offset, little, 0x8825, 4);
  if (gpsIfdOffset === null) return null;

  const gpsIfdStart = tiffStart + gpsIfdOffset;
  const latRef = readAsciiTag(view, tiffStart, gpsIfdStart, little, 1);
  const lat = readRationalTripletTag(view, tiffStart, gpsIfdStart, little, 2);
  const lngRef = readAsciiTag(view, tiffStart, gpsIfdStart, little, 3);
  const lng = readRationalTripletTag(view, tiffStart, gpsIfdStart, little, 4);

  if (!lat || !lng) return null;

  let latitude = dmsToDecimal(lat);
  let longitude = dmsToDecimal(lng);
  if (latRef === 'S') latitude = -latitude;
  if (lngRef === 'W') longitude = -longitude;

  if (!isFinite(latitude) || !isFinite(longitude) || (latitude === 0 && longitude === 0)) return null;
  return { lat: latitude, lng: longitude };
}

function forEachIfdEntry(view, ifdStart, little, callback) {
  const count = view.getUint16(ifdStart, little);
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    const tag = view.getUint16(entryOffset, little);
    const type = view.getUint16(entryOffset + 2, little);
    callback(tag, type, entryOffset + 8);
  }
}

function findTagValue(view, tiffStart, ifdStart, little, wantedTag, wantedType) {
  let result = null;
  forEachIfdEntry(view, ifdStart, little, (tag, type, valueFieldOffset) => {
    if (tag === wantedTag && type === wantedType) {
      result = view.getUint32(valueFieldOffset, little);
    }
  });
  return result;
}

function readAsciiTag(view, tiffStart, ifdStart, little, wantedTag) {
  let result = null;
  forEachIfdEntry(view, ifdStart, little, (tag, type, valueFieldOffset) => {
    if (tag === wantedTag && type === 2) {
      result = String.fromCharCode(view.getUint8(valueFieldOffset));
    }
  });
  return result;
}

function readRationalTripletTag(view, tiffStart, ifdStart, little, wantedTag) {
  let result = null;
  forEachIfdEntry(view, ifdStart, little, (tag, type, valueFieldOffset) => {
    if (tag === wantedTag && type === 5) {
      const dataStart = tiffStart + view.getUint32(valueFieldOffset, little);
      result = [0, 1, 2].map(i => {
        const num = view.getUint32(dataStart + i * 8, little);
        const den = view.getUint32(dataStart + i * 8 + 4, little);
        return den === 0 ? 0 : num / den;
      });
    }
  });
  return result;
}

function dmsToDecimal([deg, min, sec]) {
  return deg + min / 60 + sec / 3600;
}

// 이미지 압축 유틸: 업로드한 사진을 WebP, 가로 600px, 50% 화질로 변환
export function compressImageToWebP(file, { maxWidth = 600, quality = 0.5 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const targetWidth = Math.round(img.width * scale);
        const targetHeight = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('이미지 변환에 실패했습니다.'));
          },
          'image/webp',
          quality
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

<?php
session_start();
require __DIR__ . '/admin_config.php';

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
$csrf = $_SESSION['csrf'];

function supabaseRequest($method, $path, $body = null) {
    global $SUPABASE_URL, $SUPABASE_SERVICE_ROLE_KEY;
    $ch = curl_init(rtrim($SUPABASE_URL, '/') . $path);
    $headers = [
        'apikey: ' . $SUPABASE_SERVICE_ROLE_KEY,
        'Authorization: Bearer ' . $SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type: application/json',
        'Prefer: return=minimal',
    ];
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    if ($curlError) return [0, null, $curlError];
    return [$status, $response !== '' ? json_decode($response, true) : null, null];
}

// 로그아웃
if (isset($_GET['logout'])) {
    session_unset();
    session_destroy();
    header('Location: admin.php');
    exit;
}

$loginError = '';
$isConfigured = $SUPABASE_URL !== '' && $SUPABASE_SERVICE_ROLE_KEY !== '';

// 로그인 처리
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['password']) && empty($_SESSION['admin_authed'])) {
    if (!hash_equals($csrf, $_POST['csrf'] ?? '')) {
        $loginError = '요청이 올바르지 않습니다. 새로고침 후 다시 시도해주세요.';
    } elseif (hash_equals($ADMIN_PASSWORD, $_POST['password'])) {
        $_SESSION['admin_authed'] = true;
    } else {
        $loginError = '비밀번호가 올바르지 않습니다.';
    }
}

$isAuthed = !empty($_SESSION['admin_authed']);
$actionMessage = '';

// 수정 / 삭제 처리 (로그인 상태에서만)
if ($isAuthed && $isConfigured && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    if (!hash_equals($csrf, $_POST['csrf'] ?? '')) {
        $actionMessage = '요청이 올바르지 않습니다. 새로고침 후 다시 시도해주세요.';
    } else {
        $id = $_POST['id'] ?? '';

        if ($_POST['action'] === 'update' && $id !== '') {
            $payload = [
                'title' => trim($_POST['title'] ?? ''),
                'description' => trim($_POST['description'] ?? ''),
                'severity' => $_POST['severity'] ?? 'medium',
                'address' => trim($_POST['address'] ?? ''),
            ];
            [$status] = supabaseRequest('PATCH', '/rest/v1/reports?id=eq.' . urlencode($id), $payload);
            $actionMessage = ($status >= 200 && $status < 300) ? '수정되었습니다.' : '수정에 실패했습니다. (HTTP ' . $status . ')';
        } elseif ($_POST['action'] === 'delete' && $id !== '') {
            // 스토리지 사진도 함께 삭제 시도 (실패해도 무시)
            [, $rows] = supabaseRequest('GET', '/rest/v1/reports?id=eq.' . urlencode($id) . '&select=image_url');
            if (!empty($rows[0]['image_url'])) {
                $marker = '/report-photos/';
                $pos = strpos($rows[0]['image_url'], $marker);
                if ($pos !== false) {
                    $objectPath = substr($rows[0]['image_url'], $pos + strlen($marker));
                    supabaseRequest('DELETE', '/storage/v1/object/report-photos/' . $objectPath);
                }
            }
            [$status] = supabaseRequest('DELETE', '/rest/v1/reports?id=eq.' . urlencode($id));
            $actionMessage = ($status >= 200 && $status < 300) ? '삭제되었습니다.' : '삭제에 실패했습니다. (HTTP ' . $status . ')';
        }
    }
}

$reports = [];
$fetchError = '';
if ($isAuthed && $isConfigured) {
    [$status, $data, $curlError] = supabaseRequest('GET', '/rest/v1/reports?select=*&order=created_at.desc&limit=300');
    if ($curlError) {
        $fetchError = 'Supabase 연결에 실패했습니다: ' . $curlError;
    } elseif ($status >= 200 && $status < 300 && is_array($data)) {
        $reports = $data;
    } else {
        $fetchError = '신고 목록을 불러오지 못했습니다. (HTTP ' . $status . ')';
    }
}

$severityLabels = [
    'critical' => '매우 심각',
    'severe' => '심함',
    'medium' => '보통',
    'slight' => '약간',
];

function h($str) {
    return htmlspecialchars((string)$str, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>꽁초헌터 관리자</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Noto Sans KR', -apple-system, BlinkMacSystemFont, sans-serif; background: #f6f7f9; color: #111827; }
  header { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; }
  header h1 { font-size: 1.05rem; margin: 0; }
  header a { color: #6b7280; text-decoration: none; font-size: 0.85rem; font-weight: 600; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 60px; }
  .login-box { max-width: 340px; margin: 80px auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 28px; box-shadow: 0 12px 30px rgba(15,23,42,0.08); }
  .login-box h2 { margin: 0 0 18px; font-size: 1.1rem; }
  .login-box input { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.9rem; margin-bottom: 12px; }
  .login-box button { width: 100%; padding: 10px; border: none; border-radius: 8px; background: #059669; color: #fff; font-weight: 700; cursor: pointer; font-size: 0.9rem; }
  .error-msg { background: rgba(220,38,38,0.08); color: #dc2626; border: 1px solid rgba(220,38,38,0.2); border-radius: 8px; padding: 8px 12px; font-size: 0.82rem; margin-bottom: 12px; }
  .info-msg { background: rgba(5,150,105,0.08); color: #059669; border: 1px solid rgba(5,150,105,0.2); border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; margin-bottom: 16px; }
  .warn-box { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 16px; font-size: 0.85rem; line-height: 1.6; margin-bottom: 20px; }
  .report-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; margin-bottom: 14px; display: flex; gap: 14px; flex-wrap: wrap; }
  .report-thumb { width: 96px; height: 96px; border-radius: 10px; object-fit: cover; background: #f1f5f4; flex-shrink: 0; }
  .report-form { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: 8px; }
  .report-form input[type=text], .report-form textarea, .report-form select {
    width: 100%; padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 7px; font-size: 0.85rem; font-family: inherit;
  }
  .report-form textarea { resize: vertical; min-height: 44px; }
  .report-meta { font-size: 0.74rem; color: #9ca3af; display: flex; gap: 10px; flex-wrap: wrap; }
  .report-actions { display: flex; gap: 8px; margin-top: 4px; }
  .delete-form { display: flex; align-items: flex-end; }
  .btn { padding: 7px 14px; border-radius: 7px; border: none; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
  .btn-save { background: #059669; color: #fff; }
  .btn-delete { background: #fff; color: #dc2626; border: 1px solid rgba(220,38,38,0.3); }
  .empty { text-align: center; color: #9ca3af; padding: 60px 0; }
  .count-badge { font-size: 0.8rem; color: #6b7280; margin-bottom: 14px; }
</style>
</head>
<body>

<?php if (!$isAuthed): ?>

  <div class="login-box">
    <h2>꽁초헌터 관리자 로그인</h2>
    <?php if ($loginError): ?><div class="error-msg"><?= h($loginError) ?></div><?php endif; ?>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>" />
      <input type="password" name="password" placeholder="관리자 비밀번호" required autofocus />
      <button type="submit">로그인</button>
    </form>
  </div>

<?php else: ?>

  <header>
    <h1>꽁초헌터 관리자</h1>
    <a href="admin.php?logout=1">로그아웃</a>
  </header>

  <main>
    <?php if (!$isConfigured): ?>
      <div class="warn-box">
        <strong>admin_config.php에 Supabase 정보가 비어 있습니다.</strong><br />
        같은 폴더의 <code>admin_config.php</code> 파일을 열어 <code>$SUPABASE_URL</code>과
        <code>$SUPABASE_SERVICE_ROLE_KEY</code>(Supabase 프로젝트 설정 &gt; API의 service_role 키)를 입력해주세요.
        anon key가 아닌 service_role 키를 사용해야 수정/삭제가 가능합니다.
      </div>
    <?php endif; ?>

    <?php if ($actionMessage): ?>
      <div class="info-msg"><?= h($actionMessage) ?></div>
    <?php endif; ?>

    <?php if ($fetchError): ?>
      <div class="error-msg"><?= h($fetchError) ?></div>
    <?php endif; ?>

    <?php if ($isConfigured): ?>
      <div class="count-badge">전체 <?= count($reports) ?>건 (최신순, 최대 300건 표시)</div>

      <?php if (count($reports) === 0 && !$fetchError): ?>
        <div class="empty">등록된 신고가 없습니다.</div>
      <?php endif; ?>

      <?php foreach ($reports as $r): ?>
        <div class="report-card">
          <img class="report-thumb" src="<?= h($r['image_url'] ?? '') ?>" alt="" />

          <form class="report-form" method="post">
            <input type="hidden" name="csrf" value="<?= h($csrf) ?>" />
            <input type="hidden" name="action" value="update" />
            <input type="hidden" name="id" value="<?= h($r['id']) ?>" />

            <input type="text" name="title" value="<?= h($r['title'] ?? '') ?>" placeholder="제목" />
            <textarea name="description" placeholder="상세 설명"><?= h($r['description'] ?? '') ?></textarea>

            <div style="display:flex; gap:8px;">
              <select name="severity" style="max-width:160px;">
                <?php foreach ($severityLabels as $val => $label): ?>
                  <option value="<?= h($val) ?>" <?= ($r['severity'] ?? '') === $val ? 'selected' : '' ?>><?= h($label) ?></option>
                <?php endforeach; ?>
              </select>
              <input type="text" name="address" value="<?= h($r['address'] ?? '') ?>" placeholder="주소" style="flex:1;" />
            </div>

            <div class="report-meta">
              <span>제보자: <?= h($r['guest_name'] ?? '익명 헌터') ?></span>
              <span>❤ <?= (int)($r['likes_count'] ?? 0) ?></span>
              <span>🧹 <?= (int)($r['cleanup_votes'] ?? 0) ?></span>
              <span><?= h(date('Y-m-d H:i', strtotime($r['created_at'] ?? 'now'))) ?></span>
            </div>

            <div class="report-actions">
              <button type="submit" class="btn btn-save">저장</button>
            </div>
          </form>

          <form class="delete-form" method="post" onsubmit="return confirm('이 신고를 삭제할까요? 되돌릴 수 없습니다.');">
            <input type="hidden" name="csrf" value="<?= h($csrf) ?>" />
            <input type="hidden" name="action" value="delete" />
            <input type="hidden" name="id" value="<?= h($r['id']) ?>" />
            <button type="submit" class="btn btn-delete">삭제</button>
          </form>
        </div>
      <?php endforeach; ?>
    <?php endif; ?>
  </main>

<?php endif; ?>

</body>
</html>

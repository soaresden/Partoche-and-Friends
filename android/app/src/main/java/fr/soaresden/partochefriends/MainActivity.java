package fr.soaresden.partochefriends;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.Manifest;
import android.content.pm.PackageManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Partoche and Friends sur Android : l'appli web en ligne dans une WebView.
 * - toujours à jour (rien à réinstaller quand le site change) ;
 * - la connexion pCloud revient sur la même adresse (Redirect URI déclarée chez pCloud) ;
 * - les liens d'invitation / QR code « appareil » ouvrent directement l'appli.
 */
public class MainActivity extends Activity {
    static final String HOME = "https://soaresden.github.io/Partoche-and-Friends/";
    private static final int PICK_FILES = 1, CAMERA_REQ = 2;
    private PermissionRequest camRequest;   // la page demande la caméra (scanner un QR code)
    private WebView web;
    private ValueCallback<Uri[]> pending;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        // Android 15 dessine les applis SOUS la barre de notifications et la barre de navigation :
        // on met la WebView dans un cadre qui réserve leur place (et celle du clavier).
        android.widget.FrameLayout frame = new android.widget.FrameLayout(this);
        frame.setBackgroundColor(0xff16181d);
        frame.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1));
        frame.setOnApplyWindowInsetsListener((v, in) -> {
            int l, t, r, b;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = in.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout() | android.view.WindowInsets.Type.ime());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else { l = in.getSystemWindowInsetLeft(); t = in.getSystemWindowInsetTop(); r = in.getSystemWindowInsetRight(); b = in.getSystemWindowInsetBottom(); }
            v.setPadding(l, t, r, b);
            return in;
        });
        setContentView(frame);
        frame.requestApplyInsets();
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " PartocheFriends/1");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String h = u.getHost() == null ? "" : u.getHost();
                // l'appli et pCloud (connexion) restent dans l'appli ; le reste s'ouvre dans le navigateur
                if (h.equals("soaresden.github.io") || h.endsWith("pcloud.com") || h.endsWith("pcloud.link")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // 📷 Scanner un QR code : la page demande la caméra -> on demande la permission à Android
            @Override public void onPermissionRequest(PermissionRequest r) {
                runOnUiThread(() -> {
                    boolean video = false;
                    for (String res : r.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) video = true;
                    if (!video) { r.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) r.grant(new String[]{ PermissionRequest.RESOURCE_VIDEO_CAPTURE });
                    else { camRequest = r; requestPermissions(new String[]{ Manifest.permission.CAMERA }, CAMERA_REQ); }
                });
            }
            // « ＋ Partition » : choisir des .mscz sur la tablette
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pending != null) pending.onReceiveValue(null);
                pending = cb;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(i, PICK_FILES); }
                catch (Exception e) { pending = null; return false; }
                return true;
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(urlFrom(getIntent()));
    }

    // lien d'invitation (#rejoindre=…) ou QR code appareil (#appareil=…) reçu par Android
    private String urlFrom(Intent i) {
        Uri d = i == null ? null : i.getData();
        return d != null && "soaresden.github.io".equals(d.getHost()) ? d.toString() : HOME;
    }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (i.getData() != null) web.loadUrl(urlFrom(i));
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req != PICK_FILES || pending == null) { super.onActivityResult(req, res, data); return; }
        Uri[] out = null;
        if (res == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                out = new Uri[data.getClipData().getItemCount()];
                for (int k = 0; k < out.length; k++) out[k] = data.getClipData().getItemAt(k).getUri();
            } else if (data.getData() != null) out = new Uri[]{ data.getData() };
        }
        pending.onReceiveValue(out);
        pending = null;
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req != CAMERA_REQ || camRequest == null) return;
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) camRequest.grant(new String[]{ PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        else camRequest.deny();
        camRequest = null;
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
}

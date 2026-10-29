package com.casemate.legalai;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(BackgroundWorkPlugin.class);
    registerPlugin(SpeechListenPlugin.class);
    super.onCreate(savedInstanceState);
  }

  @Override
  public void onPause() {
    super.onPause();
    if (!CaseWorkService.isRunning() || getBridge() == null) return;
    WebView webView = getBridge().getWebView();
    if (webView == null) return;
    webView.onResume();
    webView.resumeTimers();
  }

  @Override
  public void onStart() {
    super.onStart();
    if (getBridge() == null) return;
    WebView webView = getBridge().getWebView();
    if (webView == null) return;
    WebSettings settings = webView.getSettings();
    settings.setSupportZoom(false);
    settings.setBuiltInZoomControls(false);
    settings.setDisplayZoomControls(false);
  }
}

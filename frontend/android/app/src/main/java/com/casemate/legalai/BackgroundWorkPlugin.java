package com.casemate.legalai;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundWork")
public class BackgroundWorkPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        requestNotificationPermission();
        Intent intent = new Intent(getContext(), CaseWorkService.class);
        intent.setAction(CaseWorkService.ACTION_START);
        intent.putExtra("title", call.getString("title", "casemate"));
        intent.putExtra("body", call.getString("body", "Working…"));
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void finish(PluginCall call) {
        Intent intent = new Intent(getContext(), CaseWorkService.class);
        intent.setAction(CaseWorkService.ACTION_FINISH);
        intent.putExtra("title", call.getString("title", "casemate"));
        intent.putExtra("body", call.getString("body", ""));
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Intent intent = new Intent(getContext(), CaseWorkService.class);
        intent.setAction(CaseWorkService.ACTION_CANCEL);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        Activity activity = getActivity();
        if (activity == null) return;
        ActivityCompat.requestPermissions(
            activity,
            new String[] { Manifest.permission.POST_NOTIFICATIONS },
            4101
        );
    }
}

package com.casemate.legalai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

/**
 * Keeps the process awake while a draft or analysis is running, then posts a
 * normal notification when that work finishes.
 */
public class CaseWorkService extends Service {
    public static final String ACTION_START = "com.casemate.legalai.WORK_START";
    public static final String ACTION_FINISH = "com.casemate.legalai.WORK_FINISH";
    public static final String ACTION_CANCEL = "com.casemate.legalai.WORK_CANCEL";

    private static final String CHANNEL_ID = "casemate_work";
    private static final int WORKING_ID = 4101;
    private static final int DONE_ID = 4102;

    private static volatile boolean running = false;

    private PowerManager.WakeLock wakeLock;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;
        if (ACTION_CANCEL.equals(action) || ACTION_FINISH.equals(action)) {
            // startForegroundService requires this even when we are about to stop.
            promoteToForeground("casemate", "Working…");
            if (ACTION_CANCEL.equals(action)) {
                stopWork(false, null, null);
            } else {
                String title = intent.getStringExtra("title");
                String body = intent.getStringExtra("body");
                stopWork(true, title, body);
            }
            return START_NOT_STICKY;
        }

        String title = intent != null ? intent.getStringExtra("title") : null;
        String body = intent != null ? intent.getStringExtra("body") : null;
        if (title == null || title.isEmpty()) title = "casemate";
        if (body == null || body.isEmpty()) body = "Working…";

        promoteToForeground(title, body);
        running = true;
        acquireWakeLock();
        return START_NOT_STICKY;
    }

    private void promoteToForeground(String title, String body) {
        Notification working = buildNotification(title, body, true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(WORKING_ID, working, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(WORKING_ID, working);
        }
    }

    private void stopWork(boolean notifyDone, String title, String body) {
        running = false;
        releaseWakeLock();
        if (notifyDone && title != null && !title.isEmpty()) {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                try {
                    manager.notify(DONE_ID, buildNotification(title, body == null ? "" : body, false));
                } catch (SecurityException ignored) {
                    // Notification permission was denied. The draft is still in the chat.
                }
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private Notification buildNotification(String title, String body, boolean ongoing) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            this,
            ongoing ? 1 : 2,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(pending)
            .setAutoCancel(!ongoing)
            .setOngoing(ongoing)
            .setOnlyAlertOnce(ongoing);
        if (!ongoing) {
            builder.setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL);
        } else {
            builder.setPriority(NotificationCompat.PRIORITY_LOW);
        }
        return builder.build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "casemate",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Analysis and draft progress");
        manager.createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "casemate:casework");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(30 * 60 * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        running = false;
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

package com.shadow.adhd.executor.blocker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Foreground service (specialUse) del blocco app — Task 59 / W5-M5.
 *
 * Polling di UsageStatsManager.queryEvents (~900ms) mentre la sessione è attiva:
 * se l'app in primo piano è "bloccata" (nel set scelto, o tutto-tranne-whitelist)
 * mostra un overlay "Torna a Shadow" e conta il tentativo. Niente
 * AccessibilityService, niente QUERY_ALL_PACKAGES. Auto-stop a endsAt.
 */
public class BlockerService extends Service {

    public static final String ACTION_START = "com.shadow.adhd.executor.blocker.START";
    public static final String ACTION_STOP = "com.shadow.adhd.executor.blocker.STOP";
    public static final String ACTION_BLOCKED_ATTEMPT = "com.shadow.adhd.executor.blocker.BLOCKED_ATTEMPT";

    public static final String EXTRA_PACKAGES = "packages";        // String[]; vuoto/assente = blocca tutto tranne whitelist
    public static final String EXTRA_ENDS_AT = "endsAtEpochMs";    // long; <=0 = nessun auto-stop
    public static final String EXTRA_SESSION_ID = "sessionId";
    public static final String EXTRA_OVERLAY_TITLE = "overlayTitle";
    public static final String EXTRA_OVERLAY_BODY = "overlayBody";

    public static final String PREFS = "shadow_blocker";
    public static final String KEY_ACTIVE = "active";
    public static final String KEY_ATTEMPTS = "blockedAttempts";
    public static final String KEY_ENDS_AT = "endsAtEpochMs";

    private static final int NOTIF_ID = 4751;
    private static final String CHANNEL_ID = "shadow_focus_shield";
    private static final long POLL_INTERVAL_MS = 900L;
    private static final long EVENT_WINDOW_MS = 10_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private UsageStatsManager usageStatsManager;
    private WindowManager windowManager;
    private View overlayView;

    private final Set<String> blockedPackages = new HashSet<>();
    private boolean blockAllMode = false;
    private long endsAtEpochMs = 0L;
    private String overlayTitle = "Torna a Shadow";
    private String overlayBody = "Sei in sessione focus. Quest'app è in pausa.";

    private Set<String> whitelist = new HashSet<>();
    private String lastForegroundPackage = null;
    private boolean overlayShown = false;
    private int blockedAttempts = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        usageStatsManager = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopBlockingInternal();
            return START_NOT_STICKY;
        }

        blockedPackages.clear();
        String[] pkgs = intent.getStringArrayExtra(EXTRA_PACKAGES);
        if (pkgs != null && pkgs.length > 0) {
            for (String p : pkgs) if (p != null && !p.isEmpty()) blockedPackages.add(p);
        }
        blockAllMode = blockedPackages.isEmpty();
        endsAtEpochMs = intent.getLongExtra(EXTRA_ENDS_AT, 0L);
        String t = intent.getStringExtra(EXTRA_OVERLAY_TITLE);
        String b = intent.getStringExtra(EXTRA_OVERLAY_BODY);
        if (t != null && !t.isEmpty()) overlayTitle = t;
        if (b != null && !b.isEmpty()) overlayBody = b;

        whitelist = buildWhitelist();
        blockedAttempts = 0;
        lastForegroundPackage = null;
        overlayShown = false;

        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putBoolean(KEY_ACTIVE, true)
                .putInt(KEY_ATTEMPTS, 0)
                .putLong(KEY_ENDS_AT, endsAtEpochMs)
                .apply();

        startForegroundWithNotification();
        handler.removeCallbacks(pollRunnable);
        handler.post(pollRunnable);
        return START_STICKY;
    }

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            try {
                if (endsAtEpochMs > 0 && System.currentTimeMillis() >= endsAtEpochMs) {
                    stopBlockingInternal();
                    return;
                }
                String fg = currentForegroundPackage();
                if (fg != null) handleForeground(fg);
            } catch (Exception ignored) {
                // il polling non deve mai crashare il service
            }
            handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    /** Ultimo pacchetto passato in primo piano nella finestra recente (cache non-vuota). */
    private String currentForegroundPackage() {
        if (usageStatsManager == null) return null;
        long end = System.currentTimeMillis();
        long begin = end - EVENT_WINDOW_MS;
        UsageEvents events = usageStatsManager.queryEvents(begin, end);
        if (events == null) return null;
        UsageEvents.Event event = new UsageEvents.Event();
        String latest = null;
        while (events.hasNextEvent()) {
            events.getNextEvent(event);
            if (event.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND
                    || event.getEventType() == UsageEvents.Event.ACTIVITY_RESUMED) {
                latest = event.getPackageName();
            }
        }
        // queryEvents può restituire finestre transitorie vuote: in quel caso
        // teniamo l'ultimo noto invece di "perdere" il primo piano.
        return latest != null ? latest : lastForegroundPackage;
    }

    private void handleForeground(String pkg) {
        boolean changed = !pkg.equals(lastForegroundPackage);
        lastForegroundPackage = pkg;

        if (isBlocked(pkg)) {
            if (changed || !overlayShown) {
                blockedAttempts++;
                persistAttempts();
                broadcastAttempt(pkg);
            }
            showOverlay();
        } else {
            hideOverlay();
        }
    }

    private boolean isBlocked(String pkg) {
        if (pkg == null) return false;
        if (whitelist.contains(pkg)) return false;
        if (pkg.startsWith(getPackageName())) return false; // Shadow stesso (anche .debug)
        return blockAllMode || blockedPackages.contains(pkg);
    }

    // ─── Overlay ────────────────────────────────────────────────────────────
    private void showOverlay() {
        if (overlayShown || windowManager == null) return;
        if (!Settings.canDrawOverlays(this)) return;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#F218181B"));
        int pad = dp(28);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(overlayTitle);
        title.setTextColor(Color.WHITE);
        title.setTextSize(24);
        title.setGravity(Gravity.CENTER);

        TextView body = new TextView(this);
        body.setText(overlayBody);
        body.setTextColor(Color.parseColor("#A1A1AA"));
        body.setTextSize(15);
        body.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams bodyLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        bodyLp.topMargin = dp(10);
        bodyLp.bottomMargin = dp(28);
        body.setLayoutParams(bodyLp);

        Button btn = new Button(this);
        btn.setText("Torna a Shadow");
        btn.setAllCaps(false);
        btn.setTextColor(Color.WHITE);
        btn.setBackgroundColor(Color.parseColor("#6366F1"));
        btn.setOnClickListener(v -> openShadow());

        root.addView(title);
        root.addView(body);
        root.addView(btn);

        int type = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY; // API 26+
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.CENTER;

        try {
            windowManager.addView(root, lp);
            overlayView = root;
            overlayShown = true;
        } catch (Exception ignored) {
        }
    }

    private void hideOverlay() {
        if (!overlayShown || overlayView == null || windowManager == null) return;
        try {
            windowManager.removeView(overlayView);
        } catch (Exception ignored) {
        }
        overlayView = null;
        overlayShown = false;
    }

    private void openShadow() {
        hideOverlay();
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            startActivity(launch);
        }
    }

    // ─── Whitelist (mai bloccabili) ───────────────────────────────────────────
    private Set<String> buildWhitelist() {
        Set<String> wl = new HashSet<>();
        wl.add(getPackageName());
        wl.add("android");
        wl.add("com.android.systemui");
        wl.add("com.android.settings");
        addResolved(wl, new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)); // launcher
        addResolved(wl, new Intent(Intent.ACTION_DIAL));                                    // dialer
        // IME corrente
        try {
            String ime = Settings.Secure.getString(getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD);
            if (ime != null && ime.contains("/")) wl.add(ime.substring(0, ime.indexOf('/')));
        } catch (Exception ignored) {
        }
        return wl;
    }

    private void addResolved(Set<String> wl, Intent intent) {
        try {
            ResolveInfo ri = getPackageManager().resolveActivity(intent, 0);
            if (ri != null && ri.activityInfo != null) wl.add(ri.activityInfo.packageName);
            List<ResolveInfo> all = getPackageManager().queryIntentActivities(intent, 0);
            for (ResolveInfo r : all) if (r.activityInfo != null) wl.add(r.activityInfo.packageName);
        } catch (Exception ignored) {
        }
    }

    // ─── Notifica FGS ─────────────────────────────────────────────────────────
    private void startForegroundWithNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Sessione focus", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification notif = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Sessione focus attiva")
                .setContentText("Shadow sta proteggendo la tua concentrazione.")
                .setSmallIcon(getApplicationInfo().icon)
                .setOngoing(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIF_ID, notif);
        }
    }

    private void stopBlockingInternal() {
        handler.removeCallbacks(pollRunnable);
        hideOverlay();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putBoolean(KEY_ACTIVE, false)
                .putInt(KEY_ATTEMPTS, blockedAttempts)
                .apply();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void persistAttempts() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putInt(KEY_ATTEMPTS, blockedAttempts).apply();
    }

    private void broadcastAttempt(String pkg) {
        Intent i = new Intent(ACTION_BLOCKED_ATTEMPT);
        i.setPackage(getPackageName());
        i.putExtra("packageName", pkg);
        i.putExtra("blockedAttempts", blockedAttempts);
        sendBroadcast(i);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(pollRunnable);
        hideOverlay();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

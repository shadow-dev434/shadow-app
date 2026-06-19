package com.shadow.adhd.executor.blocker;

import android.app.AppOpsManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * Bridge JS ↔ blocco app nativo (Task 59 / W5-M5).
 * Esposto al webview come `ShadowAppBlocker`.
 */
@CapacitorPlugin(name = "ShadowAppBlocker")
public class AppBlockerPlugin extends Plugin {

    private BroadcastReceiver attemptReceiver;

    @Override
    public void load() {
        attemptReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                JSObject data = new JSObject();
                data.put("packageName", intent.getStringExtra("packageName"));
                data.put("blockedAttempts", intent.getIntExtra("blockedAttempts", 0));
                notifyListeners("blockedAttempt", data);
            }
        };
        IntentFilter filter = new IntentFilter(BlockerService.ACTION_BLOCKED_ATTEMPT);
        ContextCompat.registerReceiver(getContext(), attemptReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (attemptReceiver != null) {
            try {
                getContext().unregisterReceiver(attemptReceiver);
            } catch (Exception ignored) {
            }
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionsState());
    }

    @SuppressWarnings("deprecation")
    private JSObject permissionsState() {
        Context ctx = getContext();
        boolean usage = false;
        try {
            AppOpsManager appOps = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            int mode = appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
            usage = mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception ignored) {
        }
        boolean overlay = Settings.canDrawOverlays(ctx);
        boolean notifications = NotificationManagerCompat.from(ctx).areNotificationsEnabled();

        JSObject out = new JSObject();
        out.put("usageAccess", usage);
        out.put("overlay", overlay);
        out.put("notifications", notifications);
        return out;
    }

    @PluginMethod
    public void requestUsageAccess(PluginCall call) {
        startSettings(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
        call.resolve(permissionsState());
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
        startSettings(i);
        call.resolve(permissionsState());
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        startSettings(i);
        call.resolve(permissionsState());
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        // Lista impostazioni (nessun permesso sensibile Play): l'utente esonera Shadow.
        startSettings(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        call.resolve();
    }

    @PluginMethod
    public void getInstalledApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN, null);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> resolved = pm.queryIntentActivities(main, 0);
        String self = getContext().getPackageName();

        JSArray apps = new JSArray();
        List<String> seen = new ArrayList<>();
        for (ResolveInfo ri : resolved) {
            if (ri.activityInfo == null) continue;
            String pkg = ri.activityInfo.packageName;
            if (pkg == null || pkg.equals(self) || seen.contains(pkg)) continue;
            seen.add(pkg);
            JSObject app = new JSObject();
            app.put("packageName", pkg);
            app.put("label", ri.loadLabel(pm).toString());
            apps.put(app);
        }
        JSObject out = new JSObject();
        out.put("apps", apps);
        call.resolve(out);
    }

    @PluginMethod
    public void startBlocking(PluginCall call) {
        Intent svc = new Intent(getContext(), BlockerService.class);
        svc.setAction(BlockerService.ACTION_START);

        JSArray packages = call.getArray("packages", null);
        if (packages != null) {
            try {
                List<String> list = packages.toList();
                svc.putExtra(BlockerService.EXTRA_PACKAGES, list.toArray(new String[0]));
            } catch (Exception ignored) {
            }
        }
        Double endsAt = call.getDouble("endsAtEpochMs");
        svc.putExtra(BlockerService.EXTRA_ENDS_AT, endsAt == null ? 0L : endsAt.longValue());
        svc.putExtra(BlockerService.EXTRA_SESSION_ID, call.getString("sessionId", ""));
        svc.putExtra(BlockerService.EXTRA_OVERLAY_TITLE, call.getString("overlayTitle", ""));
        svc.putExtra(BlockerService.EXTRA_OVERLAY_BODY, call.getString("overlayBody", ""));

        ContextCompat.startForegroundService(getContext(), svc);
        call.resolve();
    }

    @PluginMethod
    public void stopBlocking(PluginCall call) {
        Intent svc = new Intent(getContext(), BlockerService.class);
        svc.setAction(BlockerService.ACTION_STOP);
        try {
            getContext().startService(svc);
        } catch (Exception ignored) {
        }
        SharedPreferences prefs = getContext().getSharedPreferences(BlockerService.PREFS, Context.MODE_PRIVATE);
        JSObject out = new JSObject();
        out.put("blockedAttempts", prefs.getInt(BlockerService.KEY_ATTEMPTS, 0));
        call.resolve(out);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(BlockerService.PREFS, Context.MODE_PRIVATE);
        JSObject out = new JSObject();
        out.put("active", prefs.getBoolean(BlockerService.KEY_ACTIVE, false));
        out.put("blockedAttempts", prefs.getInt(BlockerService.KEY_ATTEMPTS, 0));
        long endsAt = prefs.getLong(BlockerService.KEY_ENDS_AT, 0L);
        out.put("endsAtEpochMs", endsAt > 0 ? (double) endsAt : null);
        call.resolve(out);
    }

    private void startSettings(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (Exception ignored) {
        }
    }
}

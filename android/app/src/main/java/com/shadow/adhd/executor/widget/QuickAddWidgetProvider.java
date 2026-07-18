package com.shadow.adhd.executor.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import com.shadow.adhd.executor.MainActivity;
import com.shadow.adhd.executor.R;
import com.shadow.adhd.executor.capture.ShadowCapturePlugin;

/**
 * Task 75 — widget home screen "quick add": due bottoni che lanciano
 * MainActivity con le azioni custom di ShadowCapturePlugin (QUICK_INBOX →
 * input chat focalizzato, QUICK_VOICE → riconoscimento vocale sull'inbox).
 * Il widget è solo un telecomando: zero logica, zero rete, zero stato.
 */
public class QuickAddWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int widgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_add);
            views.setOnClickPendingIntent(
                    R.id.widget_quick_add_text,
                    launchPendingIntent(context, 0, ShadowCapturePlugin.ACTION_QUICK_INBOX));
            views.setOnClickPendingIntent(
                    R.id.widget_quick_add_voice,
                    launchPendingIntent(context, 1, ShadowCapturePlugin.ACTION_QUICK_VOICE));
            manager.updateAppWidget(widgetId, views);
        }
    }

    private PendingIntent launchPendingIntent(Context context, int requestCode, String action) {
        Intent intent = new Intent(context, MainActivity.class);
        // Azione custom (non extra): requestCode+action distinti evitano il
        // collasso dei PendingIntent con FLAG_UPDATE_CURRENT.
        intent.setAction(action);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}

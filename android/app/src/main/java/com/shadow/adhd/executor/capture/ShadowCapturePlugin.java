package com.shadow.adhd.executor.capture;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Task 72 (Slice C) — cattura nativa: riceve gli intent ACTION_SEND (share
 * sheet di Android) e li consegna al layer web, che riusa il contratto dello
 * share PWA (POST /api/tasks + esito /?action=share&...). Nessuna logica di
 * prodotto qui: il nativo trasporta, il web decide.
 *
 * Consegna a doppio canale, con dedupe web-side sull'id:
 *  - cold start: l'intent arriva prima che il web sia su → getPendingShare()
 *    (consume-once) al bootstrap;
 *  - app già aperta (launchMode singleTask → handleOnNewIntent): evento
 *    "shareReceived" (retained finché il web non aggancia il listener).
 */
@CapacitorPlugin(name = "ShadowCapture")
public class ShadowCapturePlugin extends Plugin {

    private JSObject pendingShare = null;

    @Override
    public void load() {
        // Cold start via share sheet: l'intent di lancio È lo share.
        handleSendIntent(getActivity() != null ? getActivity().getIntent() : null);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleSendIntent(intent);
    }

    private void handleSendIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return;
        }
        String type = intent.getType();
        if (type == null) {
            return;
        }

        JSObject share = new JSObject();
        // Id per il dedupe web-side: lo stesso share può arrivare sia come
        // pending (cold start) sia come evento retained.
        share.put("id", String.valueOf(System.nanoTime()));

        if (type.startsWith("text/")) {
            share.put("type", "text");
            share.put("title", intent.getStringExtra(Intent.EXTRA_SUBJECT));
            share.put("text", intent.getStringExtra(Intent.EXTRA_TEXT));
        } else {
            // image/* arriva con la Slice D (OCR): finché non è cablata, ignora.
            return;
        }

        // Consuma l'intent: singleTask + rotazioni non devono riprocessarlo.
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.removeExtra(Intent.EXTRA_SUBJECT);

        pendingShare = share;
        notifyListeners("shareReceived", share, true);
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        JSObject ret = new JSObject();
        if (pendingShare != null) {
            ret.put("share", pendingShare);
            pendingShare = null;
        }
        call.resolve(ret);
    }
}

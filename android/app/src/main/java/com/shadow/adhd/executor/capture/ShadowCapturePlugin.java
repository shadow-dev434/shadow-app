package com.shadow.adhd.executor.capture;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.core.content.IntentCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;

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

    // Task 75: azioni custom di widget/App Shortcuts. Componente esplicito nel
    // PendingIntent → nessun intent-filter richiesto nel manifest.
    public static final String ACTION_QUICK_INBOX = "com.shadow.adhd.executor.action.QUICK_INBOX";
    public static final String ACTION_QUICK_VOICE = "com.shadow.adhd.executor.action.QUICK_VOICE";

    private JSObject pendingShare = null;
    private JSObject pendingQuickAction = null;

    @Override
    public void load() {
        // Cold start via share sheet: l'intent di lancio È lo share.
        Intent launch = getActivity() != null ? getActivity().getIntent() : null;
        handleSendIntent(launch);
        handleQuickActionIntent(launch);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleSendIntent(intent);
        handleQuickActionIntent(intent);
    }

    // ── Task 75: widget/shortcut → quick action ─────────────────────────────
    // Stesso doppio canale dello share (pending consume-once per il cold start
    // + evento retained per l'app già aperta), dedupe web-side sull'id.
    private void handleQuickActionIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        String kind;
        if (ACTION_QUICK_INBOX.equals(action)) {
            kind = "inbox";
        } else if (ACTION_QUICK_VOICE.equals(action)) {
            kind = "voice";
        } else {
            return;
        }
        // Consuma l'intent: singleTask + rotazioni non devono riprocessarlo.
        intent.setAction(Intent.ACTION_MAIN);

        JSObject payload = new JSObject();
        payload.put("id", String.valueOf(System.nanoTime()));
        payload.put("action", kind);
        pendingQuickAction = payload;
        notifyListeners("quickAction", payload, true);
    }

    @PluginMethod
    public void getPendingQuickAction(PluginCall call) {
        JSObject ret = new JSObject();
        if (pendingQuickAction != null) {
            ret.put("quickAction", pendingQuickAction);
            pendingQuickAction = null;
        }
        call.resolve(ret);
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
        } else if (type.startsWith("image/")) {
            // Task 72 (Slice D): immagine condivisa → copia in cache (l'URI del
            // mittente ha un grant temporaneo) → il web la manda all'OCR locale.
            Uri uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            String path = uri != null ? copyUriToCache(uri) : null;
            if (path == null) {
                return;
            }
            share.put("type", "image");
            share.put("imagePath", path);
        } else {
            return;
        }

        // Consuma l'intent: singleTask + rotazioni non devono riprocessarlo.
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.removeExtra(Intent.EXTRA_SUBJECT);
        intent.removeExtra(Intent.EXTRA_STREAM);

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

    // ── Task 72 (Slice D): foto → OCR on-device ──────────────────────────────
    // Nessun permesso CAMERA: ACTION_IMAGE_CAPTURE delega all'app fotocamera
    // di sistema (l'app non dichiara il permesso, quindi l'intent è legittimo).
    // Il file vive in cacheDir e viene cancellato appena il testo è estratto:
    // l'immagine non è mai persistita né caricata (GDPR by design).

    private String pendingPhotoPath = null;

    @PluginMethod
    public void capturePhoto(PluginCall call) {
        try {
            File out = new File(getContext().getCacheDir(), "shadow-ocr-" + System.nanoTime() + ".jpg");
            if (!out.createNewFile()) {
                call.reject("cache_unavailable");
                return;
            }
            Uri uri = FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", out);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            pendingPhotoPath = out.getAbsolutePath();
            startActivityForResult(call, intent, "photoCaptured");
        } catch (IOException e) {
            call.reject("cache_unavailable", e);
        }
    }

    @ActivityCallback
    private void photoCaptured(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        String path = pendingPhotoPath;
        pendingPhotoPath = null;
        if (result.getResultCode() == Activity.RESULT_OK && path != null) {
            call.resolve(new JSObject().put("path", path));
        } else {
            if (path != null) {
                //noinspection ResultOfMethodCallIgnored
                new File(path).delete();
            }
            call.reject("capture_cancelled");
        }
    }

    @PluginMethod
    public void pickImage(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= 33) {
            // Photo Picker: zero permessi, l'utente sceglie la singola immagine.
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
        } else {
            intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.setType("image/*");
        }
        startActivityForResult(call, intent, "imagePicked");
    }

    @ActivityCallback
    private void imagePicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.reject("capture_cancelled");
            return;
        }
        String path = copyUriToCache(uri);
        if (path == null) {
            call.reject("copy_failed");
            return;
        }
        call.resolve(new JSObject().put("path", path));
    }

    @PluginMethod
    public void recognizeText(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path_missing");
            return;
        }
        final File file = new File(path);
        try {
            InputImage image = InputImage.fromFilePath(getContext(), Uri.fromFile(file));
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                    .process(image)
                    .addOnSuccessListener(text -> {
                        deleteQuietly(file);
                        call.resolve(new JSObject().put("text", text.getText()));
                    })
                    .addOnFailureListener(e -> {
                        deleteQuietly(file);
                        call.reject("ocr_failed", e);
                    });
        } catch (IOException e) {
            deleteQuietly(file);
            call.reject("ocr_failed", e);
        }
    }

    // ── Task 72 (Slice E): voce nativa ───────────────────────────────────────
    // L'Android WebView non implementa Web Speech: la quick-add vocale passa
    // dal dialog di sistema (RecognizerIntent) — zero permessi, zero dipendenze.

    @PluginMethod
    public void startSpeech(PluginCall call) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "it-IT");
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Dimmi cosa devi fare");
        try {
            startActivityForResult(call, intent, "speechRecognized");
        } catch (Exception e) {
            // Nessun riconoscitore sul device (ActivityNotFoundException).
            call.reject("speech_unavailable", e);
        }
    }

    @ActivityCallback
    private void speechRecognized(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("capture_cancelled");
            return;
        }
        ArrayList<String> matches =
                result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        String text = matches != null && !matches.isEmpty() ? matches.get(0) : "";
        if (text.isEmpty()) {
            call.reject("capture_cancelled");
            return;
        }
        call.resolve(new JSObject().put("text", text));
    }

    private void deleteQuietly(File file) {
        // Cancella solo dentro la nostra cache: mai toccare file altrui.
        if (file.getAbsolutePath().startsWith(getContext().getCacheDir().getAbsolutePath())) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private String copyUriToCache(Uri uri) {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) {
                return null;
            }
            File out = new File(getContext().getCacheDir(), "shadow-share-" + System.nanoTime() + ".img");
            try (OutputStream os = new FileOutputStream(out)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                }
            }
            return out.getAbsolutePath();
        } catch (Exception e) {
            return null;
        }
    }
}

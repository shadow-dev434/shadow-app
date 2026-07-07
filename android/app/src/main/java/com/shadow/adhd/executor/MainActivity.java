package com.shadow.adhd.executor;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.shadow.adhd.executor.blocker.AppBlockerPlugin;
import com.shadow.adhd.executor.capture.ShadowCapturePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Task 59 / W5-M5: plugin nativo del blocco app
        registerPlugin(AppBlockerPlugin.class);
        // Task 72: cattura nativa (share sheet, OCR, voce)
        registerPlugin(ShadowCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

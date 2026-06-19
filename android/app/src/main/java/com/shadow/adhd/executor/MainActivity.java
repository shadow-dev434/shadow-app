package com.shadow.adhd.executor;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.shadow.adhd.executor.blocker.AppBlockerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Task 59 / W5-M5: plugin nativo del blocco app
        registerPlugin(AppBlockerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

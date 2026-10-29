package com.casemate.legalai;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

@CapacitorPlugin(
    name = "SpeechListen",
    permissions = {
        @Permission(alias = "speech", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class SpeechListenPlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private boolean wantListening = false;
    private String language = "en-IN";
    private final Handler main = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("speech") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("speech", call, "speechPerms");
    }

    @PermissionCallback
    private void speechPerms(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("speech") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("speech") != PermissionState.GRANTED) {
            requestPermissionForAlias("speech", call, "startAfterPerm");
            return;
        }
        language = call.getString("language", "en-IN");
        wantListening = true;
        main.post(this::beginListening);
        call.resolve();
    }

    @PermissionCallback
    private void startAfterPerm(PluginCall call) {
        if (getPermissionState("speech") != PermissionState.GRANTED) {
            call.reject("Microphone permission is required");
            return;
        }
        language = call.getString("language", "en-IN");
        wantListening = true;
        main.post(this::beginListening);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        wantListening = false;
        main.post(this::releaseRecognizer);
        call.resolve();
    }

    private void beginListening() {
        if (!wantListening) return;
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            JSObject err = new JSObject();
            err.put("error", "unavailable");
            notifyListeners("error", err);
            return;
        }
        releaseRecognizer();
        recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}

            @Override
            public void onError(int error) {
                boolean retry = wantListening && (
                    error == SpeechRecognizer.ERROR_NO_MATCH
                    || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                    || error == SpeechRecognizer.ERROR_CLIENT
                    || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY
                );
                if (retry) {
                    main.postDelayed(() -> {
                        if (wantListening) beginListening();
                    }, 280);
                    return;
                }
                JSObject err = new JSObject();
                err.put("error", String.valueOf(error));
                notifyListeners("error", err);
            }

            @Override
            public void onResults(Bundle results) {
                emitTranscript(results, true);
                if (wantListening) {
                    main.postDelayed(() -> {
                        if (wantListening) beginListening();
                    }, 180);
                }
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                emitTranscript(partialResults, false);
            }

            @Override public void onEvent(int eventType, Bundle params) {}
        });

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            recognizer.startListening(intent);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("error", "start-failed");
            notifyListeners("error", err);
        }
    }

    private void emitTranscript(Bundle results, boolean isFinal) {
        ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null || list.isEmpty()) return;
        String text = list.get(0);
        if (text == null || text.trim().isEmpty()) return;
        JSObject data = new JSObject();
        data.put("text", text);
        data.put("isFinal", isFinal);
        notifyListeners("result", data);
    }

    private void releaseRecognizer() {
        if (recognizer == null) return;
        try { recognizer.cancel(); } catch (Exception ignored) {}
        try { recognizer.destroy(); } catch (Exception ignored) {}
        recognizer = null;
    }

    @Override
    protected void handleOnDestroy() {
        wantListening = false;
        releaseRecognizer();
        super.handleOnDestroy();
    }
}

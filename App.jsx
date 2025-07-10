import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system";
import { StatusBar } from "expo-status-bar";

const CLOUD_NAME = "dgs6hc8jt";
const UPLOAD_PRESET = "video_preset";
const SHOTSTACK_API_KEY = "4BqoghUANmUAlfQ9kSEdOdCXbq3wtE2CxqUx4ga3";
const SHOTSTACK_ENDPOINT = "https://api.shotstack.io/stage";

const App = () => {
  const [videoFiles, setVideoFiles] = useState([null, null, null, null]);
  const [audioFile, setAudioFile] = useState(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingText, setProcessingText] = useState("");

  const finalVideoPlayer = useVideoPlayer(
    finalVideoUrl,
    (player) => {
      if (player && finalVideoUrl) {
        player.loop = false;
        player.muted = false;
      }
    },
    [finalVideoUrl]
  );

  useEffect(() => {
    requestPermissions();
  }, []);

  const requestPermissions = async () => {
    const { status: mediaStatus } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    const { status: libraryStatus } =
      await MediaLibrary.requestPermissionsAsync();

    if (mediaStatus !== "granted" || libraryStatus !== "granted") {
      alert("Permissions Required", "Please grant media library permissions.");
    }
  };

  const pickVideo = async (index) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
    });

    if (!result.canceled && result.assets?.[0]) {
      const updated = [...videoFiles];
      updated[index] = {
        uri: result.assets[0].uri,
        name: result.assets[0].fileName || `Video ${index + 1}`,
      };
      setVideoFiles(updated);
    }
  };

  const pickAudio = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "audio/*" });
    if (!result.canceled && result.assets?.[0]) {
      setAudioFile({
        uri: result.assets[0].uri,
        name: result.assets[0].name,
      });
    }
  };

  const uploadToCloudinary = async (fileUri, type = "video") => {
    const formData = new FormData();
    formData.append("file", {
      uri: fileUri,
      type: type === "audio" ? "audio/mpeg" : "video/mp4",
      name: "upload.mp4",
    });
    formData.append("upload_preset", UPLOAD_PRESET);

    try {
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${type}/upload`,
        {
          method: "POST",
          body: formData,
        }
      );
      const data = await res.json();
      return data.secure_url;
    } catch (err) {
      console.error("Upload error:", err);
      return null;
    }
  };

  const compileVideo = async () => {
    if (videoFiles.some((v) => v === null)) {
      alert("Please select all 4 videos");
      return;
    }
    if (!audioFile) {
      alert("Please select an audio file");
      return;
    }

    setIsProcessing(true);
    setProcessingText("Uploading files...");

    try {
      const uploadedVideos = await Promise.all(
        videoFiles.map((file) => uploadToCloudinary(file.uri, "video"))
      );
      const uploadedAudio = await uploadToCloudinary(audioFile.uri, "video");

      if (uploadedVideos.includes(null) || !uploadedAudio) {
        throw new Error("Upload failed");
      }

      setProcessingText("Compiling video...");

      const clips = uploadedVideos.map((url, idx) => ({
        asset: { type: "video", src: url },
        start: 0,
        length: 10,
        fit: "cover",
        scale: 0.5,
        position: ["topLeft", "topRight", "bottomLeft", "bottomRight"][idx],
      }));

      const renderRequest = {
        timeline: {
          background: "#000000",
          soundtrack: {
            src: uploadedAudio,
            effect: "fadeInFadeOut",
          },
          tracks: [{ clips }],
        },
        output: {
          format: "mp4",
          resolution: "sd",
        },
      };

      const response = await fetch(`${SHOTSTACK_ENDPOINT}/render`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": SHOTSTACK_API_KEY,
        },
        body: JSON.stringify(renderRequest),
      });

      const data = await response.json();
      if (data?.response?.id) {
        setProcessingText("Rendering video...");
        await pollRenderStatus(data.response.id);
      } else {
        throw new Error("Render failed: " + JSON.stringify(data));
      }
    } catch (err) {
      console.error("Error:", err);
      setIsProcessing(false);
      alert("Processing Error", err.message);
    }
  };

  const pollRenderStatus = async (renderId) => {
    try {
      const response = await fetch(`${SHOTSTACK_ENDPOINT}/render/${renderId}`, {
        headers: { "x-api-key": SHOTSTACK_API_KEY },
      });
      const data = await response.json();
      const status = data.response.status;

      if (status === "done") {
        setFinalVideoUrl(data.response.url);
        setIsProcessing(false);
      } else if (status === "failed") {
        throw new Error("Render failed");
      } else {
        setTimeout(() => pollRenderStatus(renderId), 5000);
      }
    } catch (err) {
      console.error("Polling Error:", err);
      setIsProcessing(false);
    }
  };

  const downloadVideo = async () => {
    if (!finalVideoUrl) return;

    try {
      setIsProcessing(true);
      setProcessingText("Downloading video...");

      const fileUri = FileSystem.documentDirectory + "final_video.mp4";
      const { uri } = await FileSystem.downloadAsync(finalVideoUrl, fileUri);

      const asset = await MediaLibrary.createAssetAsync(uri);
      await MediaLibrary.createAlbumAsync("VideoGridCompiler", asset, false);

      setIsProcessing(false);
      alert("Success,Video saved to your gallery!");
    } catch (err) {
      console.error("Download error:", err);
      setIsProcessing(false);
      alert("Error", "Failed to save video");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>🎬 Video Grid Compiler</Text>
        <Text style={styles.subtitle}>
          Create a 4-video grid with background music
        </Text>

        <View style={styles.grid}>
          {videoFiles.map((file, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.picker, file && styles.picked]}
              onPress={() => pickVideo(index)}
            >
              {file ? (
                <Text style={styles.pickerTextSelected}>
                  Video {index + 1} ✓
                </Text>
              ) : (
                <Text style={styles.pickerText}>Select Video {index + 1}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.audioPicker, audioFile && styles.picked]}
          onPress={pickAudio}
        >
          <Text
            style={audioFile ? styles.pickerTextSelected : styles.pickerText}
          >
            {audioFile
              ? `✓ Audio: ${audioFile.name}`
              : "Select Background Music"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.compileButton]}
          onPress={compileVideo}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>✨ Compile Video</Text>
          )}
        </TouchableOpacity>

        {isProcessing && (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color="#6A5ACD" />
            <Text style={styles.processingText}>{processingText}</Text>
          </View>
        )}

        {finalVideoUrl && (
          <View style={styles.finalVideoContainer}>
            <Text style={styles.finalVideoTitle}>Your Final Video</Text>
            <View style={styles.videoWrapper}>
              <VideoView
                player={finalVideoPlayer}
                style={styles.finalVideo}
                allowsFullscreen={true}
                allowsPictureInPicture={true}
                useNativeControls={true}
              />
            </View>
            <TouchableOpacity
              style={[styles.button, styles.downloadButton]}
              onPress={downloadVideo}
            >
              <Text style={styles.buttonText}>📥 Download Video</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  scroll: {
    paddingTop: 60,
    padding: 40,
    paddingBottom: 55,
    alignItems: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 5,
    color: "#2c3e50",
  },
  subtitle: {
    fontSize: 16,
    color: "#7f8c8d",
    marginBottom: 30,
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 25,
    width: "100%",
  },
  picker: {
    width: "48%",
    height: 120,
    marginBottom: 15,
    backgroundColor: "#e9ecef",
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#dee2e6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  picked: {
    backgroundColor: "#d1e7dd",
    borderColor: "#a3cfbb",
  },
  pickerText: {
    textAlign: "center",
    fontWeight: "600",
    color: "#495057",
    fontSize: 16,
  },
  pickerTextSelected: {
    textAlign: "center",
    fontWeight: "700",
    color: "#0f5132",
    fontSize: 16,
  },
  audioPicker: {
    width: "100%",
    height: 60,
    backgroundColor: "#e9ecef",
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 25,
    borderWidth: 1,
    borderColor: "#dee2e6",
    padding: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  button: {
    width: "100%",
    height: 60,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  compileButton: {
    backgroundColor: "#6A5ACD",
  },
  downloadButton: {
    backgroundColor: "#28a745",
    marginTop: 20,
  },
  buttonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 18,
  },
  finalVideoContainer: {
    marginTop: 20,
    alignItems: "center",
    width: "100%",
    padding: 15,
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e9ecef",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  finalVideoTitle: {
    fontWeight: "700",
    fontSize: 20,
    marginBottom: 15,
    color: "#212529",
  },
  videoWrapper: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    borderRadius: 12,
    overflow: "hidden",
  },
  finalVideo: {
    flex: 1,
  },
  processingContainer: {
    marginVertical: 20,
    alignItems: "center",
  },
  processingText: {
    marginTop: 15,
    fontSize: 16,
    color: "#495057",
    fontWeight: "500",
  },
});

export default App;

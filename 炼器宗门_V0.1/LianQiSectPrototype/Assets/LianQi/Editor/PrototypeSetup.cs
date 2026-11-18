using System;
using System.IO;
using LianQi.Runtime;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace LianQi.Editor
{
    [InitializeOnLoad]
    public static class PrototypeSetup
    {
        private const string Generated = "Assets/LianQi/Generated";
        private const string ScenePath = Generated + "/Workshop.unity";
        private const string PipelinePath = Generated + "/PrototypeURP.asset";
        private const string RendererPath = Generated + "/PrototypeRenderer.asset";
        static PrototypeSetup() { EditorApplication.delayCall += FirstImport; }
        private static void FirstImport()
        {
            if (EditorApplication.isCompiling || EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (!File.Exists(ScenePath)) Prepare();
        }
        [MenuItem("LianQi/1. Prepare first-order prototype")]
        public static void Prepare() { TryPrepare(); }
        private static bool TryPrepare()
        {
            if (EditorApplication.isPlaying) { Debug.LogWarning("Exit Play Mode before preparing the scene."); return false; }
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return false;
            Directory.CreateDirectory(Generated);
            UniversalRendererData renderer = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(RendererPath);
            if (renderer == null)
            {
                if (File.Exists(RendererPath)) throw new IOException("Existing renderer asset could not be loaded; it was preserved.");
                renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
                AssetDatabase.CreateAsset(renderer, RendererPath);
            }
            UniversalRenderPipelineAsset pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipelinePath);
            if (pipeline == null)
            {
                if (File.Exists(PipelinePath)) throw new IOException("Existing pipeline asset could not be loaded; it was preserved.");
                pipeline = UniversalRenderPipelineAsset.Create(renderer);
                AssetDatabase.CreateAsset(pipeline, PipelinePath);
            }
            GraphicsSettings.defaultRenderPipeline = pipeline;
            QualitySettings.renderPipeline = pipeline;
            PlayerSettings.companyName = "IndependentWorkshop";
            PlayerSettings.productName = "LianQiSectPrototype";
            PlayerSettings.defaultScreenWidth = 1280;
            PlayerSettings.defaultScreenHeight = 800;
            PlayerSettings.resizableWindow = true;
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.runInBackground = false;
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Standalone, ScriptingImplementation.Mono);
            if (!File.Exists(ScenePath)) CreateScene();
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            if (!Application.isBatchMode) EditorSceneManager.OpenScene(ScenePath);
            Debug.Log("LianQi prototype prepared. Open Generated/Workshop and press Play; core/runtime execution has not been verified until you run it.");
            return true;
        }
        private static Material Material(string name, Color color)
        {
            string path = Generated + "/" + name + ".mat";
            Material existing = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (existing != null) return existing;
            if (File.Exists(path)) throw new IOException("Existing material could not be loaded; preserved: " + path);
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) throw new InvalidOperationException("URP Lit shader missing. Check package resolution before proceeding.");
            Material material = new Material(shader) { name = name };
            material.SetColor("_BaseColor", color);
            AssetDatabase.CreateAsset(material, path);
            return material;
        }
        private static void Block(string name, Vector3 position, Vector3 size, Material material)
        {
            GameObject obj = GameObject.CreatePrimitive(PrimitiveType.Cube);
            obj.name = name; obj.transform.position = position; obj.transform.localScale = size;
            obj.GetComponent<Renderer>().sharedMaterial = material;
        }
        private static void CreateScene()
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            Material stone = Material("GreyStone", new Color(0.36f, 0.38f, 0.39f));
            Material dark = Material("DarkIron", new Color(0.18f, 0.2f, 0.21f));
            Material warm = Material("FurnaceClay", new Color(0.52f, 0.27f, 0.12f));
            Block("WorkshopFloor", new Vector3(0, -0.1f, 0), new Vector3(10, 0.2f, 8), stone);
            Block("BackWall", new Vector3(0, 1.8f, 3), new Vector3(10, 3.6f, 0.2f), stone);
            Block("WorkTable", new Vector3(0, 0.85f, 0), new Vector3(3, 0.25f, 1.5f), dark);
            Block("Furnace", new Vector3(-2.3f, 0.8f, 0.7f), new Vector3(1.3f, 1.6f, 1.3f), warm);
            Block("Anvil", new Vector3(0, 1.13f, 0), new Vector3(0.9f, 0.3f, 0.4f), dark);
            Block("ArtifactBlank", new Vector3(0, 1.33f, -0.07f), new Vector3(1.7f, 0.05f, 0.12f), stone);
            Block("TrialFieldA", new Vector3(2.3f, 0.15f, 0.4f), new Vector3(0.6f, 0.3f, 0.9f), warm);
            Block("TrialFieldB", new Vector3(3.0f, 0.15f, 0.4f), new Vector3(0.6f, 0.3f, 0.9f), warm);
            Block("TrialFieldC", new Vector3(3.7f, 0.15f, 0.4f), new Vector3(0.6f, 0.3f, 0.9f), warm);
            GameObject cameraObject = new GameObject("FixedWorkbenchCamera");
            Camera camera = cameraObject.AddComponent<Camera>();
            cameraObject.tag = "MainCamera";
            camera.transform.position = new Vector3(2.7f, 3.6f, -5.5f);
            camera.transform.LookAt(new Vector3(0, 0.9f, 0.4f));
            camera.fieldOfView = 48;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.13f, 0.16f, 0.18f);
            camera.rect = new Rect(0.27f, 0.55f, 0.72f, 0.28f);
            cameraObject.AddComponent<UniversalAdditionalCameraData>();
            GameObject lightObject = new GameObject("WorkshopDirectionalLight");
            Light light = lightObject.AddComponent<Light>(); light.type = LightType.Directional; light.intensity = 1.4f;
            lightObject.transform.rotation = Quaternion.Euler(50, -35, 0);
            RenderSettings.ambientLight = new Color(0.5f, 0.5f, 0.5f);
            new GameObject("FirstOrderController").AddComponent<PrototypeController>();
            if (!EditorSceneManager.SaveScene(scene, ScenePath)) throw new IOException("Scene could not be saved.");
        }
        [MenuItem("LianQi/2. Build Windows x64 prototype")]
        public static void BuildWindows()
        {
            if (EditorApplication.isPlaying) throw new InvalidOperationException("Exit Play Mode before building.");
            if (!TryPrepare()) return;
            if (!File.Exists(ScenePath)) throw new IOException("Workshop scene is not available.");
            string root = Directory.GetParent(Application.dataPath).FullName;
            string destination = Path.Combine(root, "Builds", "Windows_" + DateTime.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(destination);
            BuildReport report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath }, locationPathName = Path.Combine(destination, "LianQiSectPrototype.exe"),
                target = BuildTarget.StandaloneWindows64, options = BuildOptions.Development
            });
            if (report.summary.result != BuildResult.Succeeded) throw new InvalidOperationException("Windows build failed: " + report.summary.result);
            Debug.Log("WINDOWS_BUILD_SUCCEEDED: " + destination + "; verify actual play separately.");
        }
    }
}

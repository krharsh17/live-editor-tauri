fn main() {

    #[cfg(target_os = "macos")]
    {
        // 1) Where the linker should search for libwasmer.dylib during build
        println!("cargo:rustc-link-search=native=libs/macos");

        // 2) Link the library by its short name (libwasmer.dylib -> "wasmer")
        println!("cargo:rustc-link-lib=dylib=wasmer");

        // 3) Embed an RPATH so the bundled app can find the dylib in Resources
        // @executable_path points to MyApp.app/Contents/MacOS/
        // Resources is MyApp.app/Contents/Resources/
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Resources");
    }
    
    tauri_build::build()
}

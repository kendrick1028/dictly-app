// swift-tools-version: 5.10
import PackageDescription
let package = Package(
    name: "probe",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift", exact: "0.31.4")
    ],
    targets: [
        .executableTarget(
            name: "probe",
            dependencies: [
                .product(name: "MLX", package: "mlx-swift"),
                .product(name: "MLXFast", package: "mlx-swift"),
            ],
            path: "Sources/probe"
        )
    ]
)

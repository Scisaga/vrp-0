import org.gradle.testing.jacoco.plugins.JacocoTaskExtension
import org.gradle.testing.jacoco.tasks.JacocoReport

plugins {
    java
    application
    idea
    id("io.quarkus")
    jacoco
}
group = "one.rewind.xforce"
version = "1.0.4-alpha-SNAPSHOT"

//
repositories {

    maven {
        url = uri("https://repository.apache.org/content/groups/public/")
    }
    maven {
        url = uri("https://maven.aliyun.com/repository/public/")
    }
    maven {
        url = uri("https://repo1.maven.org/maven2/")
    }

    maven {
        url = uri("https://jitpack.io")
    }
}


val quarkusPlatformGroupId: String by project
val quarkusPlatformArtifactId: String by project
val quarkusPlatformVersion: String by project
val optaplannerVersion: String by project

dependencies {

    implementation(enforcedPlatform("${quarkusPlatformGroupId}:${quarkusPlatformArtifactId}:${quarkusPlatformVersion}"))
    implementation("io.quarkus:quarkus-container-image-docker")
    implementation("io.quarkus:quarkus-resteasy-reactive-jackson")
    implementation("io.quarkus:quarkus-undertow")
    implementation("io.quarkus:quarkus-arc")
    implementation("io.quarkus:quarkus-arc-deployment")
    implementation("io.quarkus:quarkus-smallrye-openapi")
    implementation("io.quarkus:quarkus-micrometer-registry-prometheus")
    implementation("io.modelcontextprotocol.sdk:mcp-core:0.18.1")
    implementation("io.modelcontextprotocol.sdk:mcp-json-jackson2:0.18.1")

    // https://mvnrepository.com/artifact/org.jfree/jfreechart
    implementation("org.jfree:jfreechart:1.5.5")

    // TODO
    // implementation("io.hypersistence:hypersistence-utils-hibernate-63:3.7.3")

    // Guava
    implementation("com.google.guava:guava:33.0.0-jre")
    // Typesafe Config
    implementation("com.typesafe:config:1.3.4")

    implementation("com.github.rholder:guava-retrying:2.0.0")

    implementation("com.github.kklisura.cdt:cdt-java-client:4.0.0")

    // 相似性
    implementation("info.debatty:java-string-similarity:1.1.0")

    // https://mvnrepository.com/artifact/org.apache.commons/commons-math3
    implementation("org.apache.commons:commons-math3:3.6.1")
    implementation("org.apache.commons:commons-lang3:3.11")

    // Jackson json
    implementation("com.fasterxml.jackson.core:jackson-core:2.15.2")
    implementation("com.fasterxml.jackson.core:jackson-annotations:2.15.2")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.15.2")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.15.2")

    // POI Read XLSX
    implementation("org.apache.poi:poi:5.2.0")
    implementation("org.apache.poi:poi-ooxml:5.2.0")

    // https://github.com/bucket4j/bucket4j
    implementation("com.bucket4j:bucket4j-core:8.10.1")

    // Log4J
    implementation("org.apache.logging.log4j:log4j-api:2.22.1")
    implementation("org.apache.logging.log4j:log4j-core:2.22.1")
    implementation("org.jboss.logmanager:log4j2-jboss-logmanager:1.1.2.Final")

    //
    implementation(enforcedPlatform("org.optaplanner:optaplanner-bom:${optaplannerVersion}"))
    implementation("org.optaplanner:optaplanner-quarkus")
    implementation("org.optaplanner:optaplanner-quarkus-jackson")
    implementation("org.optaplanner:optaplanner-quarkus-deployment")
    testImplementation("org.optaplanner:optaplanner-test")

    testImplementation(platform("org.junit:junit-bom:5.9.1"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("io.quarkus:quarkus-junit5")
    testImplementation("io.rest-assured:rest-assured")

    //runtimeOnly("io.netty.incubator:netty-incubator-transport-classes-io_uring:0.0.25.Final")
}

// Java源码编译兼容性
java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

tasks.withType<Javadoc>{
    options.encoding = "UTF-8"
}

tasks.withType<Test> {
    maxHeapSize = "4g"
    systemProperty("file.encoding", "UTF-8")
    systemProperty("java.util.logging.manager", "org.jboss.logmanager.LogManager")
    extensions.configure<JacocoTaskExtension> {
        destinationFile = layout.buildDirectory.file("jacoco/${name}.exec").get().asFile
    }
}

jacoco {
    toolVersion = "0.8.12"
}

tasks.named<Test>("test") {
    useJUnitPlatform {
        excludeTags("app", "external", "manual")
    }
}

tasks.register<Test>("appTest") {
    group = "verification"
    description = "Runs in-process Quarkus application tests tagged with @Tag(\"app\")"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    maxHeapSize = "4g"
    shouldRunAfter(tasks.named("test"))
    useJUnitPlatform {
        includeTags("app")
    }
    systemProperty("file.encoding", "UTF-8")
    systemProperty("java.util.logging.manager", "org.jboss.logmanager.LogManager")
}

tasks.register<Test>("externalTest") {
    group = "verification"
    description = "Runs external-system tests tagged with @Tag(\"external\")"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    maxHeapSize = "4g"
    shouldRunAfter(tasks.named("appTest"))
    useJUnitPlatform {
        includeTags("external")
    }
    systemProperty("file.encoding", "UTF-8")
    systemProperty("java.util.logging.manager", "org.jboss.logmanager.LogManager")
    systemProperty("vrp.external.enabled", System.getProperty("vrp.external.enabled", System.getenv("VRP_EXTERNAL_TESTS") ?: "false"))
}

tasks.register<Test>("manualTest") {
    group = "verification"
    description = "Runs manual/script-style tests tagged with @Tag(\"manual\")"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    maxHeapSize = "4g"
    shouldRunAfter(tasks.named("externalTest"))
    useJUnitPlatform {
        includeTags("manual")
    }
    systemProperty("file.encoding", "UTF-8")
    systemProperty("java.util.logging.manager", "org.jboss.logmanager.LogManager")
}

tasks.register<Test>("integrationTest") {
    group = "verification"
    description = "Compatibility alias for external integration tests tagged with @Tag(\"external\")"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    maxHeapSize = "4g"
    shouldRunAfter(tasks.named("appTest"))
    useJUnitPlatform {
        includeTags("external")
    }
    systemProperty("file.encoding", "UTF-8")
    systemProperty("java.util.logging.manager", "org.jboss.logmanager.LogManager")
    systemProperty("vrp.external.enabled", System.getProperty("vrp.external.enabled", System.getenv("VRP_EXTERNAL_TESTS") ?: "false"))
}

tasks.register("allStableTest") {
    group = "verification"
    description = "Runs stable unit and in-process application tests"
    dependsOn(tasks.named("test"), tasks.named("appTest"))
}

val stableCoverageExcludes = listOf(
    "one/rewind/xforce/geo/RouteDrawer*",
    "one/rewind/xforce/vehicle_routing/bootstrap/ScenarioBuilder*",
    "one/rewind/xforce/vehicle_routing/bootstrap/ScenarioUtil*",
    "one/rewind/xforce/vehicle_routing/bootstrap/TimeWindowSupplier*",
    "one/rewind/xforce/vehicle_routing/domain/cost/AgentAnalyser*",
    "one/rewind/xforce/vehicle_routing/domain/cost/ItemDelayAnalyser*",
    "one/rewind/xforce/vehicle_routing/solver/stat/**"
)

tasks.register<JacocoReport>("jacocoStableTestReport") {
    group = "verification"
    description = "Generates an aggregate JaCoCo coverage report for stable unit and app tests"
    dependsOn(tasks.named("test"), tasks.named("appTest"))

    executionData(
        layout.buildDirectory.file("jacoco/test.exec"),
        layout.buildDirectory.file("jacoco/appTest.exec")
    )
    classDirectories.setFrom(
        files(sourceSets.main.get().output.classesDirs.map { classDir ->
            fileTree(classDir) {
                exclude(stableCoverageExcludes)
            }
        })
    )
    sourceDirectories.setFrom(sourceSets.main.get().allSource.srcDirs)

    reports {
        html.required.set(true)
        xml.required.set(true)
        csv.required.set(false)
    }
}

tasks.named("check") {
    dependsOn(tasks.named("allStableTest"))
}

// 编译编码
tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-parameters")
}

tasks.register("quarkusRunDebug") {
    group = "application"
    description = "Run Quarkus dev mode with hot reload and debugger"

    dependsOn("quarkusDev")
}

tasks.named("quarkusDev") {
    doFirst {
        if (gradle.taskGraph.hasTask(":quarkusRunDebug")) {
            mapOf(
                "debug" to "5005",
                "suspend" to "n",
                "debugHost" to "0.0.0.0",
                "quarkus.http.host" to "0.0.0.0",
                "vrp.optaplanner.dev-ui.enabled" to "false"
            ).forEach { (key, value) ->
                if (System.getProperty(key).isNullOrBlank()) {
                    System.setProperty(key, value)
                }
            }
        }
    }
}

tasks.quarkusBuild {
    nativeArgs {
        "container-build" to true
        "builder-image" to "quay.io/quarkus/quarkus-micro-image:2.0"
    }
}

// build不需要打Tar包
tasks.getByName<Tar>("distTar").enabled = false

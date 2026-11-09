import ProjectFacts from "../models/ProjectFacts.js";
import { APPROVED_FACT_PROJECT_NAMES } from "../config/projectFacts.js";

export async function getPublicProjectSummaries(_req, res) {
  try {
    const projects = await ProjectFacts.find({
      approvalStatus: "approved",
      projectName: { $in: APPROVED_FACT_PROJECT_NAMES },
    })
      .select(
        "projectName location propertyConfigurations priceInformation.startingFrom possessionTimeline reraInformation -_id",
      )
      .lean();

    return res.json({
      projects: projects.map((project) => ({
        projectName: project.projectName,
        location: project.location ?? null,
        propertyConfigurations: [...(project.propertyConfigurations ?? [])],
        priceInformation: project.priceInformation
          ? { startingFrom: project.priceInformation.startingFrom ?? null }
          : null,
        possessionTimeline: project.possessionTimeline ?? null,
        reraInformation: project.reraInformation ?? null,
      })),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Could not load project information.",
    });
  }
}
